PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);

CREATE TABLE IF NOT EXISTS messenger_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  external_account_id TEXT,
  last_sync_at TEXT,
  last_connected_at TEXT,
  last_disconnected_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS connections_user_idx ON messenger_connections(user_id);
CREATE INDEX IF NOT EXISTS connections_user_provider_idx ON messenger_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS connections_status_idx ON messenger_connections(status);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messenger_connections(id) ON DELETE CASCADE,
  external_contact_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone_number TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_connection_external_unique ON contacts(connection_id, external_contact_id);
CREATE INDEX IF NOT EXISTS contacts_user_idx ON contacts(user_id);
CREATE INDEX IF NOT EXISTS contacts_connection_idx ON contacts(connection_id);
CREATE INDEX IF NOT EXISTS contacts_name_idx ON contacts(display_name);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messenger_connections(id) ON DELETE CASCADE,
  external_chat_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('direct', 'group', 'unknown')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_connection_external_unique ON conversations(connection_id, external_chat_id);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id);
CREATE INDEX IF NOT EXISTS conversations_connection_idx ON conversations(connection_id);
CREATE INDEX IF NOT EXISTS conversations_type_idx ON conversations(type);
CREATE INDEX IF NOT EXISTS conversations_name_idx ON conversations(display_name);

CREATE TABLE IF NOT EXISTS voice_messages (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messenger_connections(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  external_message_id TEXT NOT NULL,
  sender_external_id TEXT NOT NULL,
  sender_display_name TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  mime_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size INTEGER,
  local_file_path TEXT,
  download_status TEXT NOT NULL CHECK(download_status IN ('pending', 'downloading', 'downloaded', 'failed')),
  download_error TEXT,
  transcription_status TEXT NOT NULL CHECK(transcription_status IN ('not_started', 'queued', 'preparing', 'processing', 'finalizing', 'completed', 'failed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_connection_external_unique ON voice_messages(connection_id, external_message_id);
CREATE INDEX IF NOT EXISTS voice_user_idx ON voice_messages(user_id);
CREATE INDEX IF NOT EXISTS voice_connection_idx ON voice_messages(connection_id);
CREATE INDEX IF NOT EXISTS voice_conversation_idx ON voice_messages(conversation_id);
CREATE INDEX IF NOT EXISTS voice_contact_idx ON voice_messages(contact_id);
CREATE INDEX IF NOT EXISTS voice_sent_idx ON voice_messages(sent_at);
CREATE INDEX IF NOT EXISTS voice_transcription_status_idx ON voice_messages(transcription_status);
CREATE INDEX IF NOT EXISTS voice_download_status_idx ON voice_messages(download_status);

CREATE TABLE IF NOT EXISTS voice_message_names (
  voice_message_id TEXT PRIMARY KEY NOT NULL REFERENCES voice_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_message_names_user_idx ON voice_message_names(user_id);

CREATE TABLE IF NOT EXISTS transcription_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voice_message_id TEXT NOT NULL REFERENCES voice_messages(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  requested_language TEXT,
  detected_language TEXT,
  status TEXT NOT NULL,
  progress_phase TEXT NOT NULL,
  progress_type TEXT NOT NULL,
  progress_percent REAL,
  phase_percent REAL,
  processed_audio_seconds REAL,
  total_audio_seconds REAL,
  estimated_remaining_seconds REAL,
  elapsed_milliseconds INTEGER NOT NULL DEFAULT 0,
  partial_text TEXT,
  external_job_id TEXT,
  worker_id TEXT,
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  progress_updated_at TEXT NOT NULL,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON transcription_jobs(user_id);
CREATE INDEX IF NOT EXISTS jobs_voice_idx ON transcription_jobs(voice_message_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON transcription_jobs(status);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON transcription_jobs(created_at);
CREATE INDEX IF NOT EXISTS jobs_progress_idx ON transcription_jobs(progress_updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_per_voice ON transcription_jobs(voice_message_id) WHERE status IN ('queued', 'preparing', 'processing', 'finalizing');

CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voice_message_id TEXT NOT NULL REFERENCES voice_messages(id) ON DELETE CASCADE,
  transcription_job_id TEXT NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  requested_language TEXT,
  detected_language TEXT,
  text TEXT NOT NULL,
  duration_milliseconds INTEGER NOT NULL,
  audio_duration_seconds REAL NOT NULL,
  real_time_factor REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS transcriptions_job_unique ON transcriptions(transcription_job_id);
CREATE INDEX IF NOT EXISTS transcriptions_user_idx ON transcriptions(user_id);
CREATE INDEX IF NOT EXISTS transcriptions_voice_idx ON transcriptions(voice_message_id);
CREATE INDEX IF NOT EXISTS transcriptions_language_idx ON transcriptions(detected_language);

CREATE TABLE IF NOT EXISTS transcription_progress_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transcription_job_id TEXT NOT NULL REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  phase TEXT NOT NULL,
  progress_type TEXT NOT NULL,
  percent REAL,
  phase_percent REAL,
  processed_audio_seconds REAL,
  total_audio_seconds REAL,
  estimated_remaining_seconds REAL,
  elapsed_milliseconds INTEGER NOT NULL,
  partial_text_delta TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS progress_job_sequence_unique ON transcription_progress_events(transcription_job_id, sequence);
CREATE INDEX IF NOT EXISTS progress_job_idx ON transcription_progress_events(transcription_job_id);
CREATE INDEX IF NOT EXISTS progress_created_idx ON transcription_progress_events(created_at);

CREATE TABLE IF NOT EXISTS application_settings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS settings_user_key_unique ON application_settings(user_id, key);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY NOT NULL,
  worker_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS worker_heartbeats_type_heartbeat_idx ON worker_heartbeats(worker_type, heartbeat_at);
