import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./connection.js";
import { AppError } from "../errors.js";
import type { ApplicationContext } from "../context.js";

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

export class Repositories {
  constructor(public readonly sqlite: SqliteDatabase) {}

  assertKnownUser(userId: string): void {
    if (!this.sqlite.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) throw new AppError("USER_NOT_FOUND", "The selected user does not exist.", 401);
  }
  assertOwns(table: "messenger_connections" | "conversations" | "voice_messages" | "transcription_jobs", userId: string, recordId: string): void {
    const record = this.sqlite.prepare(`SELECT user_id AS userId FROM ${table} WHERE id = ?`).get(recordId) as { userId: string } | undefined;
    if (!record) {
      const code = table === "messenger_connections" ? "CONNECTION_NOT_FOUND" : table === "voice_messages" ? "VOICE_MESSAGE_NOT_FOUND" : "FORBIDDEN";
      throw new AppError(code, "The requested record was not found.", 404);
    }
    if (record.userId !== userId) throw new AppError("FORBIDDEN", "You do not have access to this record.", 403);
  }
  listConnections(context: ApplicationContext) { return this.sqlite.prepare("SELECT id, provider, display_name AS displayName, status, external_account_id AS externalAccountId, last_sync_at AS lastSyncAt, last_connected_at AS lastConnectedAt, last_error_code AS lastErrorCode, last_error_message AS lastErrorMessage, created_at AS createdAt FROM messenger_connections c WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM application_settings s WHERE s.user_id=c.user_id AND s.key='removed_connection:' || c.id) ORDER BY created_at DESC").all(context.userId); }
  getConnection(context: ApplicationContext, connectionId: string) { this.assertOwns("messenger_connections", context.userId, connectionId); return this.sqlite.prepare("SELECT * FROM messenger_connections WHERE id = ?").get(connectionId) as Record<string, any>; }
  addConnection(context: ApplicationContext, provider: string, displayName: string) {
    const connectionId = id("conn"), timestamp = now();
    this.sqlite.prepare("INSERT INTO messenger_connections(id,user_id,provider,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(connectionId, context.userId, provider, displayName, "disconnected", timestamp, timestamp);
    return this.getConnection(context, connectionId);
  }
  updateConnection(context: ApplicationContext, connectionId: string, values: Record<string, unknown>): void {
    this.assertOwns("messenger_connections", context.userId, connectionId);
    const allowed: Record<string, string> = { status: "status", externalAccountId: "external_account_id", lastSyncAt: "last_sync_at", lastConnectedAt: "last_connected_at", lastDisconnectedAt: "last_disconnected_at", lastErrorCode: "last_error_code", lastErrorMessage: "last_error_message" };
    const entries = Object.entries(values).filter(([key]) => allowed[key]); if (!entries.length) return;
    this.sqlite.prepare(`UPDATE messenger_connections SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...entries.map(([, value]) => value), now(), connectionId, context.userId);
  }
  listConversations(context: ApplicationContext, search?: string) {
    const query = `%${search ?? ""}%`;
    return this.sqlite.prepare(`SELECT c.id,c.display_name AS displayName,c.type,c.connection_id AS connectionId,
      CASE WHEN c.type='direct' THEN (SELECT contact.avatar_url FROM voice_messages recent JOIN contacts contact ON contact.id=recent.contact_id WHERE recent.conversation_id=c.id ORDER BY recent.sent_at DESC LIMIT 1) ELSE NULL END AS avatarUrl,
      COUNT(v.id) AS voiceMessageCount,MAX(v.sent_at) AS latestVoiceMessageAt,
      SUM(CASE WHEN v.transcription_status IN ('queued','preparing','processing','finalizing') THEN 1 ELSE 0 END) AS activeTranscriptions
      FROM conversations c JOIN voice_messages v ON v.conversation_id=c.id AND v.user_id=c.user_id
      WHERE c.user_id=? AND c.display_name LIKE ? GROUP BY c.id ORDER BY latestVoiceMessageAt DESC`).all(context.userId, query);
  }
  listContacts(context: ApplicationContext, search?: string) {
    return this.sqlite.prepare(`SELECT c.id,c.display_name AS displayName,c.phone_number AS phoneNumber,c.avatar_url AS avatarUrl,c.connection_id AS connectionId,COUNT(v.id) AS voiceMessageCount,MAX(v.sent_at) AS latestVoiceMessageAt FROM contacts c JOIN voice_messages v ON v.contact_id=c.id AND v.user_id=c.user_id WHERE c.user_id=? AND c.display_name LIKE ? GROUP BY c.id ORDER BY latestVoiceMessageAt DESC`).all(context.userId, `%${search ?? ""}%`);
  }
  listVoiceMessages(context: ApplicationContext, filters: { conversationId?: string; contactId?: string; connectionId?: string; status?: string; search?: string; limit?: number; offset?: number; oldestFirst?: boolean } = {}) {
    const clauses = ["v.user_id = ?"], values: unknown[] = [context.userId];
    for (const [key, column] of [["conversationId","v.conversation_id"],["contactId","v.contact_id"],["connectionId","v.connection_id"],["status","v.transcription_status"]] as const) if (filters[key]) { clauses.push(`${column} = ?`); values.push(filters[key]); }
    if (filters.search?.trim()) {
      const pattern = `%${filters.search.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      clauses.push("(COALESCE(t.text, '') LIKE ? ESCAPE '\\' OR COALESCE(j.partial_text, '') LIKE ? ESCAPE '\\' OR COALESCE(n.name, '') LIKE ? ESCAPE '\\' OR v.sender_display_name LIKE ? ESCAPE '\\')");
      values.push(pattern, pattern, pattern, pattern);
    }
    values.push(Math.min(filters.limit ?? 20, 100), filters.offset ?? 0);
    return this.sqlite.prepare(`SELECT v.id,n.name, v.sender_display_name AS senderName,contact.avatar_url AS senderAvatarUrl,v.sent_at AS sentAt,v.duration_seconds AS durationSeconds,v.mime_type AS mimeType,v.file_size AS fileSize,v.download_status AS downloadStatus,v.transcription_status AS transcriptionStatus,v.conversation_id AS conversationId,c.display_name AS conversationName,t.text AS transcript,t.detected_language AS detectedLanguage,j.id AS jobId,j.status AS jobStatus,j.progress_phase AS progressPhase,j.progress_percent AS progressPercent,j.estimated_remaining_seconds AS estimatedRemainingSeconds,j.elapsed_milliseconds AS elapsedMilliseconds,j.partial_text AS partialText FROM voice_messages v JOIN conversations c ON c.id=v.conversation_id LEFT JOIN voice_message_names n ON n.voice_message_id=v.id AND n.user_id=v.user_id LEFT JOIN contacts contact ON contact.id=v.contact_id LEFT JOIN transcription_jobs j ON j.id=(SELECT j2.id FROM transcription_jobs j2 WHERE j2.voice_message_id=v.id ORDER BY j2.created_at DESC LIMIT 1) LEFT JOIN transcriptions t ON t.id=(SELECT t2.id FROM transcriptions t2 WHERE t2.voice_message_id=v.id ORDER BY t2.created_at DESC LIMIT 1) WHERE ${clauses.join(" AND ")} ORDER BY v.sent_at ${filters.oldestFirst ? "ASC" : "DESC"} LIMIT ? OFFSET ?`).all(...values);
  }
  getVoiceMessage(context: ApplicationContext, voiceMessageId: string) { this.assertOwns("voice_messages", context.userId, voiceMessageId); return this.sqlite.prepare("SELECT * FROM voice_messages WHERE id=? AND user_id=?").get(voiceMessageId, context.userId) as Record<string, any>; }
  setVoiceMessageName(context: ApplicationContext, voiceMessageId: string, value: string | null): { id: string; name: string | null } {
    this.assertOwns("voice_messages", context.userId, voiceMessageId);
    const name = value?.trim() || null;
    if (name && name.length > 120) throw new AppError("VALIDATION_ERROR", "The message name must be 120 characters or fewer.", 400);
    if (!name) {
      this.sqlite.prepare("DELETE FROM voice_message_names WHERE voice_message_id=? AND user_id=?").run(voiceMessageId, context.userId);
    } else {
      const timestamp = now();
      this.sqlite.prepare("INSERT INTO voice_message_names(voice_message_id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(voice_message_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at WHERE user_id=excluded.user_id").run(voiceMessageId, context.userId, name, timestamp, timestamp);
    }
    return { id: voiceMessageId, name };
  }
  getJob(context: ApplicationContext, jobId: string) { this.assertOwns("transcription_jobs", context.userId, jobId); return this.sqlite.prepare("SELECT id,user_id AS userId,voice_message_id AS voiceMessageId,provider,model,requested_language AS requestedLanguage,detected_language AS detectedLanguage,status,progress_phase AS progressPhase,progress_type AS progressType,progress_percent AS progressPercent,phase_percent AS phasePercent,processed_audio_seconds AS processedAudioSeconds,total_audio_seconds AS totalAudioSeconds,estimated_remaining_seconds AS estimatedRemainingSeconds,elapsed_milliseconds AS elapsedMilliseconds,partial_text AS partialText,error_code AS errorCode,error_message AS errorMessage,external_job_id AS externalJobId,created_at AS createdAt,updated_at AS updatedAt FROM transcription_jobs WHERE id=?").get(jobId) as Record<string, any>; }
  listJobs(context: ApplicationContext) { return this.sqlite.prepare("SELECT id,voice_message_id AS voiceMessageId,status,progress_phase AS progressPhase,progress_percent AS progressPercent,created_at AS createdAt FROM transcription_jobs WHERE user_id=? ORDER BY created_at DESC").all(context.userId); }
  progressEvents(context: ApplicationContext, jobId: string, afterSequence = 0) { this.assertOwns("transcription_jobs", context.userId, jobId); return this.sqlite.prepare("SELECT sequence,phase,progress_type AS progressType,percent,phase_percent AS phasePercent,processed_audio_seconds AS processedAudioSeconds,total_audio_seconds AS totalAudioSeconds,estimated_remaining_seconds AS estimatedRemainingSeconds,elapsed_milliseconds AS elapsedMilliseconds,partial_text_delta AS partialTextDelta,created_at AS createdAt FROM transcription_progress_events WHERE transcription_job_id=? AND sequence>? ORDER BY sequence").all(jobId, afterSequence); }
  deleteVoiceMessage(context: ApplicationContext, voiceMessageId: string): Record<string, any> { const message = this.getVoiceMessage(context, voiceMessageId); this.sqlite.prepare("DELETE FROM voice_messages WHERE id=? AND user_id=?").run(voiceMessageId, context.userId); return message; }
}

export const assertUserOwnsConnection = (repos: Repositories, userId: string, recordId: string) => repos.assertOwns("messenger_connections", userId, recordId);
export const assertUserOwnsConversation = (repos: Repositories, userId: string, recordId: string) => repos.assertOwns("conversations", userId, recordId);
export const assertUserOwnsVoiceMessage = (repos: Repositories, userId: string, recordId: string) => repos.assertOwns("voice_messages", userId, recordId);
export const assertUserOwnsTranscriptionJob = (repos: Repositories, userId: string, recordId: string) => repos.assertOwns("transcription_jobs", userId, recordId);
