# Privacy and retention

Voice messages can contain personal and sensitive information. Obtain consent and comply with applicable law. Baileys is unofficial and WhatsApp may restrict its use. Self-hosted Whisper keeps audio away from an external transcription API, while the SaaS operator still processes and stores customer audio and transcripts.

The default preserves source audio. Settings keys support `audioRetention=indefinite`, `audioRetentionDays`, `deleteAudioAfterTranscription`, `transcriptRetention=indefinite`, and `deleteFailedTemporaryFiles`. Operators should schedule retention enforcement for their deployment. Deletion removes local message files and cascading database content; backups can retain deleted content until their expiry.
