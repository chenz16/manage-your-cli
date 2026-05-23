"""SenseVoice local STT server — privacy-first, on-device speech-to-text for Holon.

Runs Alibaba's open-source SenseVoiceSmall model (via FunASR) entirely on the
user's own machine. Holon's voice-transcription-service POSTs audio here instead
of to a cloud API, so voice never leaves the device.

This is a thin HTTP adapter around the REAL SenseVoice model (NOT a mock): it
loads `iic/SenseVoiceSmall` through FunASR's AutoModel and runs actual inference.
The HTTP contract matches what Holon expects:

    POST /transcribe   (multipart/form-data: file=<audio>, [language=zh|en|auto])
      -> 200 { "text": "<transcript>", "provider": "sensevoice", "ms": <int> }
    GET  /health       -> 200 { "ok": true, "model": "SenseVoiceSmall", "device": "<cpu|cuda>" }

── User setup (one-time) ────────────────────────────────────────────────────
  pip install funasr fastapi "uvicorn[standard]" python-multipart torch torchaudio
  # (first run auto-downloads the SenseVoiceSmall weights from ModelScope/HF)
  python scripts/sensevoice-server.py            # serves http://127.0.0.1:8769

Then in Holon → Connectors → Voice STT: choose "SenseVoice (local)" and set the
URL to http://127.0.0.1:8769. Done — voice transcription is now fully on-device.

Env overrides: SENSEVOICE_HOST (default 127.0.0.1), SENSEVOICE_PORT (default
8769), SENSEVOICE_DEVICE (default auto: cuda if available else cpu),
SENSEVOICE_MODEL (default iic/SenseVoiceSmall).
"""

import os
import sys
import tempfile
import time


def _pick_device(explicit: str | None) -> str:
    if explicit:
        return explicit
    try:
        import torch
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001 - torch import/probe failure → cpu
        return "cpu"


def main() -> int:
    host = os.environ.get("SENSEVOICE_HOST", "127.0.0.1")
    port = int(os.environ.get("SENSEVOICE_PORT", "8769"))
    device = _pick_device(os.environ.get("SENSEVOICE_DEVICE"))
    model_id = os.environ.get("SENSEVOICE_MODEL", "iic/SenseVoiceSmall")

    try:
        from fastapi import FastAPI, UploadFile, Form, HTTPException
        from fastapi.responses import JSONResponse
        import uvicorn
        from funasr import AutoModel
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
    except ImportError as exc:
        print(
            "Missing dependency: " + str(exc) + "\n"
            "Install with: pip install funasr fastapi 'uvicorn[standard]' "
            "python-multipart torch torchaudio",
            file=sys.stderr,
        )
        return 1

    print(f"Loading SenseVoice model '{model_id}' on {device} (first run downloads weights)…", flush=True)
    model = AutoModel(
        model=model_id,
        trust_remote_code=False,
        vad_model="fsmn-vad",
        vad_kwargs={"max_single_segment_time": 30000},
        device=device,
        disable_update=True,
    )
    print("Model loaded. Ready.", flush=True)

    app = FastAPI(title="Holon SenseVoice STT", version="1.0")

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "model": model_id, "device": device}

    @app.post("/transcribe")
    async def transcribe(file: UploadFile, language: str = Form("auto")) -> JSONResponse:  # noqa: B008
        started = time.time()
        suffix = os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3"
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="empty audio file")
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            # Real SenseVoice inference.
            res = model.generate(
                input=tmp_path,
                cache={},
                language=language or "auto",   # zh / en / yue / ja / ko / auto
                use_itn=True,                  # inverse text normalization (numbers, punctuation)
                batch_size_s=60,
                merge_vad=True,
                merge_length_s=15,
            )
            raw = res[0]["text"] if res else ""
            text = rich_transcription_postprocess(raw).strip()
        except Exception as exc:  # noqa: BLE001 - surface inference errors to caller
            raise HTTPException(status_code=500, detail=f"inference failed: {exc}") from exc
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        return JSONResponse({
            "text": text,
            "provider": "sensevoice",
            "ms": int((time.time() - started) * 1000),
        })

    print(f"SenseVoice STT serving on http://{host}:{port}  (POST /transcribe, GET /health)", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
