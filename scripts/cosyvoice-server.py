"""Holon local TTS server.

Keeps the CosyVoice connector filename and HTTP contract but synthesizes audio
via edge-tts (Microsoft Edge neural voices — no API key, no local model files,
requires internet access to reach Microsoft's TTS endpoint).

HTTP contract (unchanged from prior Kokoro version):
    POST /synthesize  JSON { "text": "...", "voice"?: "...", "language"?: "zh|en" }
      -> audio/mpeg bytes (MP3)
    GET  /health
      -> { "ok": true, "engine": "edge-tts", "provider": "edge-tts" }
"""

import argparse
import asyncio
import os
import sys
import time
from typing import Any


# Voice mapping by language prefix.  The caller may pass an explicit SSML voice
# name (e.g. "zh-CN-XiaoxiaoNeural"); if so we honour it verbatim.
_VOICE_MAP: dict[str, str] = {
    "zh": "zh-CN-XiaoxiaoNeural",
    "en": "en-US-AriaNeural",
}
_DEFAULT_VOICE = "en-US-AriaNeural"


def _pick_voice(voice: str | None, language: str | None) -> str:
    if voice and voice.strip():
        return voice.strip()
    lang = (language or "").strip().lower().split("-")[0]
    return _VOICE_MAP.get(lang, _DEFAULT_VOICE)


async def _synthesize_mp3(text: str, voice: str) -> bytes:
    """Call edge-tts and collect all audio chunks into a single bytes object."""
    import edge_tts  # imported here so the import error surfaces clearly

    communicate = edge_tts.Communicate(text, voice)
    buf = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    if not buf:
        raise RuntimeError("edge-tts returned no audio data")
    return buf


def main() -> int:
    parser = argparse.ArgumentParser(description="Holon local TTS server (edge-tts)")
    parser.add_argument("--host", default=os.environ.get("TTS_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TTS_PORT", "8770")))
    args = parser.parse_args()

    try:
        import edge_tts  # noqa: F401 — validate import before starting server
        import uvicorn
        from fastapi import FastAPI, HTTPException
        from fastapi.responses import Response
        from pydantic import BaseModel
    except ImportError as exc:
        print(
            "Missing dependency: " + str(exc) + "\n"
            "Install with: uv pip install --python .venv-tts edge-tts fastapi 'uvicorn[standard]'",
            file=sys.stderr,
        )
        return 1

    class SynthesizeRequest(BaseModel):
        text: str
        voice: str | None = None
        language: str | None = None

    app = FastAPI(title="Holon Local TTS", version="2.0")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "engine": "edge-tts",
            "provider": "edge-tts",
        }

    @app.post("/synthesize")
    async def synthesize(req: SynthesizeRequest) -> Response:
        started = time.time()
        text = req.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required")

        voice = _pick_voice(req.voice, req.language)
        try:
            data = await _synthesize_mp3(text, voice)
        except Exception as exc:  # noqa: BLE001 - surface synthesis errors to caller
            raise HTTPException(status_code=500, detail=f"synthesis failed: {exc}") from exc

        headers = {
            "X-Holon-TTS-Provider": "edge-tts",
            "X-Holon-TTS-Voice": voice,
            "X-Holon-TTS-Ms": str(int((time.time() - started) * 1000)),
        }
        return Response(content=data, media_type="audio/mpeg", headers=headers)

    print(
        f"Local TTS (edge-tts) serving on http://{args.host}:{args.port} "
        "(POST /synthesize, GET /health)",
        flush=True,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
