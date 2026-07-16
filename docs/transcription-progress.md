# Transcription progress

Phases allocate overall progress as queued 0–5%, preparation 5–15%, optional model loading 15–20%, real audio processing 20–95%, finalization 95–99%, and completion 100%. The worker emits monotonic sequence numbers. Node ignores duplicate events, stores phase and overall percentages, and exposes authenticated replayable SSE. UI polling once per second is the fallback.

Partial text contains completed chunks only, is labeled incomplete, and cannot be exported. The final normalized transcript replaces it on completion.
