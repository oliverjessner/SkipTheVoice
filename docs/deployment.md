# Deployment and troubleshooting

Use local disk or a single-host Docker volume for SQLite. Set a strong `WHISPER_WORKER_INTERNAL_TOKEN`, protect TLS at the ingress, seed only development systems, and back up the SQLite database plus required media according to policy. The app creates its final schema automatically on startup. One Node runner is the conservative default. Health endpoints report database, writable storage, queue, FFmpeg, device, capacity, and model state without secrets.

For CUDA, use a PyTorch CUDA base image, install FFmpeg and `openai-whisper`, set `WHISPER_DEVICE=cuda`, and reserve an NVIDIA device in Compose. For Apple development set `WHISPER_DEVICE=mps` only when PyTorch reports MPS available.

If audio fails, run `ffprobe` and `skipthevoice config validate`. If jobs remain queued, start `npm run dev:worker` and check worker health. If WhatsApp closes, inspect the sanitized connection state and reconnect; a logged-out connection requires new authentication. Database busy errors indicate long transactions or unsuitable storage.
