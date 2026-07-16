import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = { createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull() };

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), email: text("email"), name: text("name").notNull(), ...timestamps,
}, (t) => [uniqueIndex("users_email_unique").on(t.email)]);

export const messengerConnections = sqliteTable("messenger_connections", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), displayName: text("display_name").notNull(), status: text("status").notNull(),
  externalAccountId: text("external_account_id"), lastSyncAt: text("last_sync_at"), lastConnectedAt: text("last_connected_at"),
  lastDisconnectedAt: text("last_disconnected_at"), lastErrorCode: text("last_error_code"), lastErrorMessage: text("last_error_message"), ...timestamps,
}, (t) => [index("connections_user_idx").on(t.userId), index("connections_user_provider_idx").on(t.userId, t.provider), index("connections_status_idx").on(t.status)]);

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => messengerConnections.id, { onDelete: "cascade" }),
  externalContactId: text("external_contact_id").notNull(), displayName: text("display_name").notNull(), phoneNumber: text("phone_number"), avatarUrl: text("avatar_url"), ...timestamps,
}, (t) => [uniqueIndex("contacts_connection_external_unique").on(t.connectionId, t.externalContactId), index("contacts_user_idx").on(t.userId), index("contacts_connection_idx").on(t.connectionId), index("contacts_name_idx").on(t.displayName)]);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => messengerConnections.id, { onDelete: "cascade" }),
  externalChatId: text("external_chat_id").notNull(), type: text("type").notNull(), displayName: text("display_name").notNull(), ...timestamps,
}, (t) => [uniqueIndex("conversations_connection_external_unique").on(t.connectionId, t.externalChatId), index("conversations_user_idx").on(t.userId), index("conversations_connection_idx").on(t.connectionId), index("conversations_type_idx").on(t.type), index("conversations_name_idx").on(t.displayName)]);

export const voiceMessages = sqliteTable("voice_messages", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => messengerConnections.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }), externalMessageId: text("external_message_id").notNull(),
  senderExternalId: text("sender_external_id").notNull(), senderDisplayName: text("sender_display_name").notNull(), sentAt: text("sent_at").notNull(),
  durationSeconds: real("duration_seconds").notNull(), mimeType: text("mime_type").notNull(), fileExtension: text("file_extension").notNull(),
  fileSize: integer("file_size"), localFilePath: text("local_file_path"), downloadStatus: text("download_status").notNull(),
  downloadError: text("download_error"), transcriptionStatus: text("transcription_status").notNull(), ...timestamps,
}, (t) => [uniqueIndex("voice_connection_external_unique").on(t.connectionId, t.externalMessageId), index("voice_user_idx").on(t.userId), index("voice_connection_idx").on(t.connectionId), index("voice_conversation_idx").on(t.conversationId), index("voice_contact_idx").on(t.contactId), index("voice_sent_idx").on(t.sentAt), index("voice_transcription_status_idx").on(t.transcriptionStatus), index("voice_download_status_idx").on(t.downloadStatus)]);

export const voiceMessageNames = sqliteTable("voice_message_names", {
  voiceMessageId: text("voice_message_id").primaryKey().references(() => voiceMessages.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(), ...timestamps,
}, (t) => [index("voice_message_names_user_idx").on(t.userId)]);

export const transcriptionJobs = sqliteTable("transcription_jobs", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  voiceMessageId: text("voice_message_id").notNull().references(() => voiceMessages.id, { onDelete: "cascade" }), provider: text("provider").notNull(),
  model: text("model").notNull(), requestedLanguage: text("requested_language"), detectedLanguage: text("detected_language"), status: text("status").notNull(),
  progressPhase: text("progress_phase").notNull(), progressType: text("progress_type").notNull(), progressPercent: real("progress_percent"), phasePercent: real("phase_percent"),
  processedAudioSeconds: real("processed_audio_seconds"), totalAudioSeconds: real("total_audio_seconds"), estimatedRemainingSeconds: real("estimated_remaining_seconds"),
  elapsedMilliseconds: integer("elapsed_milliseconds").notNull().default(0), partialText: text("partial_text"), externalJobId: text("external_job_id"), workerId: text("worker_id"),
  errorCode: text("error_code"), errorMessage: text("error_message"), queuedAt: text("queued_at").notNull(), startedAt: text("started_at"), completedAt: text("completed_at"),
  failedAt: text("failed_at"), cancelledAt: text("cancelled_at"), progressUpdatedAt: text("progress_updated_at").notNull(), heartbeatAt: text("heartbeat_at"), ...timestamps,
}, (t) => [index("jobs_user_idx").on(t.userId), index("jobs_voice_idx").on(t.voiceMessageId), index("jobs_status_idx").on(t.status), index("jobs_created_idx").on(t.createdAt), index("jobs_progress_idx").on(t.progressUpdatedAt)]);

export const transcriptions = sqliteTable("transcriptions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  voiceMessageId: text("voice_message_id").notNull().references(() => voiceMessages.id, { onDelete: "cascade" }),
  transcriptionJobId: text("transcription_job_id").notNull().references(() => transcriptionJobs.id, { onDelete: "cascade" }), provider: text("provider").notNull(), model: text("model").notNull(),
  requestedLanguage: text("requested_language"), detectedLanguage: text("detected_language"), text: text("text").notNull(), durationMilliseconds: integer("duration_milliseconds").notNull(),
  audioDurationSeconds: real("audio_duration_seconds").notNull(), realTimeFactor: real("real_time_factor"), ...timestamps,
}, (t) => [uniqueIndex("transcriptions_job_unique").on(t.transcriptionJobId), index("transcriptions_user_idx").on(t.userId), index("transcriptions_voice_idx").on(t.voiceMessageId), index("transcriptions_language_idx").on(t.detectedLanguage)]);

export const transcriptionProgressEvents = sqliteTable("transcription_progress_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), transcriptionJobId: text("transcription_job_id").notNull().references(() => transcriptionJobs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(), phase: text("phase").notNull(), progressType: text("progress_type").notNull(), percent: real("percent"), phasePercent: real("phase_percent"),
  processedAudioSeconds: real("processed_audio_seconds"), totalAudioSeconds: real("total_audio_seconds"), estimatedRemainingSeconds: real("estimated_remaining_seconds"), elapsedMilliseconds: integer("elapsed_milliseconds").notNull(), partialTextDelta: text("partial_text_delta"), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("progress_job_sequence_unique").on(t.transcriptionJobId, t.sequence), index("progress_job_idx").on(t.transcriptionJobId), index("progress_created_idx").on(t.createdAt)]);

export const applicationSettings = sqliteTable("application_settings", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), key: text("key").notNull(), value: text("value").notNull(), ...timestamps,
}, (t) => [uniqueIndex("settings_user_key_unique").on(t.userId, t.key)]);

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(), workerType: text("worker_type").notNull(),
  startedAt: text("started_at").notNull(), heartbeatAt: text("heartbeat_at").notNull(),
}, (t) => [index("worker_heartbeats_type_heartbeat_idx").on(t.workerType, t.heartbeatAt)]);
