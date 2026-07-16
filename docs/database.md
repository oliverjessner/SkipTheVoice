# Database

SQLite is the only application database. A single idempotent bootstrap schema defines users, connections, contacts, conversations, voice messages, jobs, progress events, transcripts, settings, and worker heartbeats with foreign keys and explicit indexes. A partial unique index prevents multiple active jobs per voice message. Deletion cascades job/event/transcript rows. UTC ISO-8601 timestamps are sortable and consistent across Node and Python boundaries.

Use `skipthevoice db status`, `seed`, `backup`, and `integrity-check`. Backups use the SQLite online backup API.
