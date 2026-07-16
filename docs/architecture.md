# Architecture

`apps/web` contains the Next.js presentation and authenticated route layer. `packages/cli` is the standalone Commander interface. `packages/core` owns configuration, authorization, repositories, provider abstractions, storage, exports, and job orchestration. `apps/whisper-worker` owns media normalization, model lifetime, actual audio-position progress, partial segments, cancellation, and ETA.

Web requests and CLI commands resolve an `ApplicationContext`; repositories repeat the ownership predicate. The local development session falls back to `DEFAULT_USER_ID`, which must exist. Adding a future authentication provider changes context resolution, not business services. A messenger registry can add providers later, but only `WhatsAppBaileysProvider` exists.
