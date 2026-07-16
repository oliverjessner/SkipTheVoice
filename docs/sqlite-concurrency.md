# SQLite concurrency

Connections enable WAL, foreign keys, a configurable busy timeout, and normal synchronous mode. Job claiming uses a short immediate transaction with a status predicate, so only one runner wins. Final completion and status changes are transactional. SQLite remains a single-writer database: keep transactions short, place the database on a reliable local filesystem, and avoid network-mounted volumes. Multi-region deployment requires a different persistence design.

Stale active jobs are requeued after `TRANSCRIPTION_STALE_AFTER_SECONDS`. The Python worker keeps jobs in memory, so a Python restart causes the Node runner to requeue rather than resume that external job.
