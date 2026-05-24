# ADR: Voice service (reference: holon-engineering main)

Status: Proposed · 2026-05-23 · Owner-directed ("参考 holon-engineering 的 main 设计语音服务")

## Reference (what main has, that we adopt)
holon main's voice = **3 surfaces**, all local-first, no cloud unless the owner opts in:
1. **App STT** — composer mic + hands-free Voice Mode (VAD listen→transcribe→send→AI→auto-read→loop, barge-in). Client records via `MediaRecorder` → `POST /api/v1/connectors/voice/transcribe` → `voice-transcription-service.transcribeAudio()` routes by `owner.stt_provider`: `whisper_cpp` / `faster_whisper` / `sensevoice` (local, OpenAI-compatible) or `openai` (owner-key, optional).
2. **App TTS** — 🔊 read-aloud on assistant messages + voice-mode auto-read, with **chunked TTS** (fast long text) + speed control. `POST /api/v1/connectors/tts/synthesize` → `voice-synthesis-service.synthesizeSpeech()`: `cosyvoice` (local) / **`edge-tts`** (local, main's new default) / `openai` (owner-key).
3. **WeChat voice-message transcription** (`wechat-voice-transcribe.ts` + pywxdump) — decode WeChat Silk voice (`.silk`/`.aud` from sharded MediaMSG DBs) → WAV → faster-whisper → replace `[语音]` with text in the conversation (so the owner can read/search/summarize). P0 for Chinese SMB.

## Decision — one desktop voice service, three consumers
The voice service lives entirely on the **desktop** (manage-your-cli, the server). Three consumers reuse it; **no new engines, no tokens on the phone**:

```
                ┌─ desktop ChatSurface (mic / read-aloud / Voice Mode)  [already restored]
 voice service ─┼─ mobile 微作 (按住说话 / read-aloud)  → via mobile-runtime proxy → desktop routes
  (STT + TTS)   └─ wechat-daemon (Silk voice → faster-whisper → conversation)
```

- **Engines = owner config, local-first.** STT: whisper_cpp / faster_whisper / sensevoice (local) + openai (owner-key). TTS: cosyvoice / edge-tts (local) + openai (owner-key). The OpenAI key is an *auxiliary, owner-config* key (same allowance as the voice keys the owner OK'd) — consistent with "we don't deal with [subscription/runtime] tokens".
- **Mobile = thin client, reuse the same routes.** The phone records with `MediaRecorder` and POSTs to the **desktop's** `/transcribe` + `/synthesize` through `mobile-runtime` (device-token). Plan C: the phone holds no STT/TTS engine. Short 按住说话 clips over LAN are fine; **phone-native `android.speech.SpeechRecognizer`** stays a *future* latency optimization (handoff §3), not v1 — v1 reuses main's exact pipeline so there's one code path.
- **WeChat voice = desk-only.** The wechat-daemon (desk) decodes + transcribes; mobile sees the transcribed text via the desk relay (consistent with "mobile reads WeChat via desk", [[project_myc_platform_strategy]]).

## Security
`/connectors/voice/transcribe` + `/connectors/tts/synthesize` gated by `requireDeviceTokenForRemote` (desktop webview = local-secret/loopback; mobile = device-token). Audio is transient (not persisted server-side beyond transcription). No audio is shipped to any cloud unless the owner picked an OpenAI engine.

## State vs main (gap analysis — CORRECTED 2026-05-23 after verification)
Already in manage-your-cli (byte-identical to main): STT service (4 engines), TTS service, transcribe + tts/synthesize + health routes, **desktop ChatSurface voice UX** (mic/voice-mode/read-aloud) AND **chunked TTS** (ChatSurface diff vs main = 0), AND **edge-tts** — `scripts/cosyvoice-server.py` synthesizes via edge-tts under the local-TTS slot (no key, no models); `install-tts-wsl.sh` installs it.
**V1 (edge-tts + chunked TTS) = ALREADY PRESENT + VERIFIED** (`/health`→`{ok,engine:edge-tts}`, `/synthesize`→200, 12.6 KB MP3 24 kHz). Earlier "missing" note was wrong — it came over with the extraction/restore.
**Actually missing vs main:**
- **Mobile voice**: 按住说话 + read-aloud not wired in the mobile app (via proxy).
- **WeChat voice transcription** (`wechat-voice-transcribe.ts` + the pywxdump Silk path) — not ported.

## Slice plan
- **V1 — desktop TTS edge-tts + chunked: ✅ DONE (present + verified).** To use: `bash scripts/install-tts-wsl.sh` → `/connectors` TTS engine = Local, URL `http://127.0.0.1:8770`. Read-aloud then uses edge-tts, chunked.
- **V2 — mobile voice:** wire 按住说话 (MediaRecorder→desktop `/transcribe` via mobile-runtime) + 🔊 read-aloud (→ `/synthesize`) into the mobile app. (Mobile track / joint.)
- **V3 — WeChat voice transcription:** desk wechat-daemon: Silk→WAV→faster-whisper→replace `[语音]`; surfaces in conversation + mobile relay. (Desk, ties to wechat-daemon.)

Each slice ships independently; engines stay local-first + owner-config. Implementation delegated per slice (Codex/subagent); manager verifies + promotes.
