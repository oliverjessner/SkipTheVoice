# Transcription provider

`TranscriptionProvider` separates job submission, state lookup, SSE progress, cancellation, and health from the application. `SelfHostedWhisperProvider` uploads a validated owned file with an internal bearer token. It rejects failed worker responses and never forwards Python stack traces.

The SQLite runner claims queued jobs, stores the external ID, consumes monotonic events, persists progress, and atomically stores final transcript state. Browser and CLI clients observe persisted state; closing either client does not stop work.
