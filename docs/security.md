# Security

Every owned query includes `userId`; central assertions protect connections, conversations, voice messages, and jobs. Files resolve beneath sanitized per-user roots. Audio is size/type/duration bounded, private, atomically written, and streamed through authenticated routes. Worker calls use an internal bearer token. State-changing browser requests verify same-origin `Origin` headers. React renders transcripts as text.

Do not expose the data volume, credential directory, database, internal token, QR content, pairing codes, absolute paths, or logs publicly. Production deployments need a real authentication adapter, secure cookies/TLS, rate limiting, volume encryption, key management, audit retention, and CSRF/session hardening appropriate to their ingress.
