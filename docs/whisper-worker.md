# Whisper worker

FastAPI exposes `/health`, `/v1/model`, transcription creation/state/events/cancel endpoints. Uploads are bounded, saved to a private temporary directory, normalized by argument-array FFmpeg execution to mono 16 kHz PCM, then deleted. The open-source Whisper model is loaded lazily and kept in memory.

Real transcription works in completed 30-second chunks, permitting actual processed-duration progress, partial completed text, and cancellation between chunks. `WHISPER_MOCK=true` provides deterministic automated/local testing without downloading a model. CPU, CUDA, and MPS selection is explicit.
