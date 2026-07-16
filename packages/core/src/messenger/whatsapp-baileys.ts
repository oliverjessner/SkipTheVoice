import { mkdirSync } from "node:fs";
import { Readable } from "node:stream";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  normalizeMessageContent,
  useMultiFileAuthState,
  type Chat,
  type Contact,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { AudioStorage } from "../audio/storage.js";
import { getConfig } from "../config.js";
import type { ApplicationContext } from "../context.js";
import { id, now, Repositories } from "../database/repositories.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { resolveInside } from "../security/paths.js";
import { isPttVoiceMessage } from "./ptt.js";
import type {
  DownloadedAudio,
  MessengerConnectOptions,
  MessengerConnectionStatus,
  MessengerProvider,
  SyncResult,
} from "./types.js";

interface AuthView { qr?: string; pairingCode?: string; updatedAt: string }

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function whatsappIdentifierLabel(identifier: string): string {
  const local = identifier.split("@")[0]?.split(":")[0] ?? identifier;
  const digits = local.replace(/\D/g, "");
  return digits.length >= 7 && digits.length === local.length ? `+${digits}` : local;
}

export function preferredWhatsAppName(contact: Partial<Contact> | undefined, pushName: string | null | undefined, identifier: string): string {
  return nonEmpty(contact?.name)
    ?? nonEmpty(contact?.verifiedName)
    ?? nonEmpty(contact?.notify)
    ?? (nonEmpty(contact?.username) ? `@${nonEmpty(contact?.username)}` : undefined)
    ?? nonEmpty(pushName)
    ?? whatsappIdentifierLabel(contact?.phoneNumber ?? identifier);
}

export class WhatsAppBaileysProvider implements MessengerProvider {
  readonly providerType = "whatsapp";
  private readonly sockets = new Map<string, WASocket>();
  private readonly authViews = new Map<string, AuthView>();
  private readonly messages = new Map<string, WAMessage>();
  private readonly contacts = new Map<string, Map<string, Contact>>();
  private readonly chatNames = new Map<string, Map<string, string>>();
  private readonly avatarLookups = new Map<string, Set<string>>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly repositories: Repositories, private readonly storage = new AudioStorage()) {}

  private clearReconnectTimer(connectionId: string): void {
    const timer = this.reconnectTimers.get(connectionId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(connectionId);
  }

  private scheduleReconnect(context: ApplicationContext, connectionId: string, options: MessengerConnectOptions): void {
    if (this.reconnectTimers.has(connectionId)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(connectionId);
      void this.connect(context, connectionId, options).catch((error) => logger.error({ connectionId, error: error instanceof Error ? error.message : "Reconnect failed" }, "WhatsApp reconnect failed"));
    }, 2_000);
    timer.unref();
    this.reconnectTimers.set(connectionId, timer);
  }

  hasActiveSocket(connectionId: string): boolean { return this.sockets.has(connectionId); }

  getAuthenticationView(context: ApplicationContext, connectionId: string): AuthView | undefined {
    this.repositories.assertOwns("messenger_connections", context.userId, connectionId);
    return this.authViews.get(connectionId);
  }

  async removeCredentials(context: ApplicationContext, connectionId: string): Promise<void> {
    this.repositories.assertOwns("messenger_connections", context.userId, connectionId);
    await import("node:fs/promises").then((fs) => fs.rm(this.credentialsPath(context.userId, connectionId), { recursive: true, force: true }));
  }

  private credentialsPath(userId: string, connectionId: string): string {
    return resolveInside(getConfig().dataDirectory, "users", userId, "connections", connectionId, "credentials");
  }

  private rememberContacts(context: ApplicationContext, connectionId: string, updates: Partial<Contact>[]): void {
    const cache = this.contacts.get(connectionId) ?? new Map<string, Contact>();
    this.contacts.set(connectionId, cache);
    const timestamp = now();
    this.repositories.sqlite.transaction(() => {
      for (const update of updates) {
        if (!update.id) continue;
        const existing = cache.get(update.id);
        const merged = { ...existing, ...update, id: update.id } as Contact;
        const keys = [...new Set([merged.id, merged.lid, merged.phoneNumber].filter((value): value is string => Boolean(value)))];
        for (const key of keys) cache.set(key, merged);
        const hasDescriptiveName = Boolean(nonEmpty(merged.name)
          ?? nonEmpty(merged.verifiedName)
          ?? nonEmpty(merged.notify)
          ?? nonEmpty(merged.username));
        const displayName = preferredWhatsAppName(merged, undefined, merged.id);
        const phoneNumber = merged.phoneNumber ? whatsappIdentifierLabel(merged.phoneNumber) : null;
        const avatarUrl = merged.imgUrl?.startsWith("https://") ? merged.imgUrl : null;
        for (const key of keys) {
          this.repositories.sqlite.prepare(`UPDATE contacts SET
            display_name=CASE WHEN ? THEN ? ELSE display_name END,
            phone_number=COALESCE(?,phone_number),avatar_url=COALESCE(?,avatar_url),updated_at=?
            WHERE user_id=? AND connection_id=? AND external_contact_id=?`).run(hasDescriptiveName ? 1 : 0, displayName, phoneNumber, avatarUrl, timestamp, context.userId, connectionId, key);
          if (hasDescriptiveName) {
            this.repositories.sqlite.prepare("UPDATE voice_messages SET sender_display_name=?,updated_at=? WHERE user_id=? AND connection_id=? AND sender_external_id=?").run(displayName, timestamp, context.userId, connectionId, key);
            this.repositories.sqlite.prepare("UPDATE conversations SET display_name=?,updated_at=? WHERE user_id=? AND connection_id=? AND type='direct' AND external_chat_id=?").run(displayName, timestamp, context.userId, connectionId, key);
          }
        }
      }
    })();
  }

  private async refreshProfilePictures(context: ApplicationContext, connectionId: string, socket: WASocket, identifiers: string[]): Promise<void> {
    const lookedUp = this.avatarLookups.get(connectionId) ?? new Set<string>();
    this.avatarLookups.set(connectionId, lookedUp);
    for (const identifier of [...new Set(identifiers.filter(Boolean))]) {
      const contact = this.contact(connectionId, identifier);
      const aliases = [...new Set([identifier, contact?.id, contact?.lid, contact?.phoneNumber].filter((value): value is string => Boolean(value)))];
      const stored = aliases.some((alias) => this.repositories.sqlite.prepare("SELECT 1 FROM contacts WHERE user_id=? AND connection_id=? AND external_contact_id=?").get(context.userId, connectionId, alias));
      if (!stored || lookedUp.has(identifier)) continue;
      lookedUp.add(identifier);
      try {
        const avatarUrl = await socket.profilePictureUrl(identifier, "preview", 5_000);
        if (!avatarUrl?.startsWith("https://")) continue;
        const timestamp = now();
        for (const alias of aliases) {
          this.repositories.sqlite.prepare("UPDATE contacts SET avatar_url=?,updated_at=? WHERE user_id=? AND connection_id=? AND external_contact_id=?").run(avatarUrl, timestamp, context.userId, connectionId, alias);
        }
      } catch {
        // Missing profile pictures are expected when the contact's privacy settings hide them.
      }
    }
  }

  private async linkContactAliases(context: ApplicationContext, connectionId: string, socket: WASocket, updates: Partial<Contact>[]): Promise<Partial<Contact>[]> {
    const linked = await Promise.all(updates.map(async (update) => {
      if (!update.id) return update;
      try {
        if (update.id.endsWith("@lid") && !update.phoneNumber) {
          const phoneNumber = await socket.signalRepository.lidMapping.getPNForLID(update.id);
          return phoneNumber ? { ...update, lid: update.lid ?? update.id, phoneNumber } : update;
        }
        if (update.id.endsWith("@s.whatsapp.net") && !update.lid) {
          const lid = await socket.signalRepository.lidMapping.getLIDForPN(update.id);
          return lid ? { ...update, lid, phoneNumber: update.phoneNumber ?? update.id } : update;
        }
      } catch {
        // Alias mappings can arrive later; a future contact or message event retries the link.
      }
      return update;
    }));
    this.rememberContacts(context, connectionId, linked);
    return linked;
  }

  private async refreshStoredProfilePictures(context: ApplicationContext, connectionId: string, socket: WASocket): Promise<void> {
    const rows = this.repositories.sqlite.prepare("SELECT external_contact_id AS externalContactId FROM contacts WHERE user_id=? AND connection_id=?").all(context.userId, connectionId) as { externalContactId: string }[];
    await this.refreshProfilePictures(context, connectionId, socket, rows.map((row) => row.externalContactId));
  }

  private async refreshStoredGroups(context: ApplicationContext, connectionId: string, socket: WASocket): Promise<void> {
    const rows = this.repositories.sqlite.prepare("SELECT external_chat_id AS externalChatId,display_name AS displayName FROM conversations WHERE user_id=? AND connection_id=? AND type='group'").all(context.userId, connectionId) as { externalChatId: string; displayName: string }[];
    for (const row of rows) await this.conversationName(context, socket, connectionId, row.externalChatId, row.displayName, true);
  }

  private rememberChats(context: ApplicationContext, connectionId: string, chats: Partial<Chat>[]): void {
    const cache = this.chatNames.get(connectionId) ?? new Map<string, string>();
    this.chatNames.set(connectionId, cache);
    const timestamp = now();
    for (const chat of chats) {
      const chatId = nonEmpty(chat.id);
      const name = nonEmpty((chat as Chat & { name?: string }).name);
      if (!chatId || !name) continue;
      cache.set(chatId, name);
      this.repositories.sqlite.prepare("UPDATE conversations SET display_name=?,updated_at=? WHERE user_id=? AND connection_id=? AND external_chat_id=?").run(name, timestamp, context.userId, connectionId, chatId);
    }
  }

  private contact(connectionId: string, identifier: string): Contact | undefined {
    return this.contacts.get(connectionId)?.get(identifier);
  }

  private async conversationName(context: ApplicationContext, socket: WASocket, connectionId: string, remoteJid: string, senderName: string, isGroup: boolean): Promise<string> {
    if (!isGroup) return senderName;
    const cached = this.chatNames.get(connectionId)?.get(remoteJid);
    if (cached) return cached;
    try {
      const metadata = await socket.groupMetadata(remoteJid);
      this.rememberContacts(context, connectionId, metadata.participants);
      const subject = nonEmpty(metadata.subject);
      if (subject) {
        const chats = this.chatNames.get(connectionId) ?? new Map<string, string>();
        chats.set(remoteJid, subject);
        this.chatNames.set(connectionId, chats);
        this.repositories.sqlite.prepare("UPDATE conversations SET display_name=?,updated_at=? WHERE user_id=? AND connection_id=? AND external_chat_id=?").run(subject, now(), context.userId, connectionId, remoteJid);
        return subject;
      }
    } catch {
      // The group identifier remains an honest fallback until metadata arrives.
    }
    return whatsappIdentifierLabel(remoteJid);
  }

  async connect(context: ApplicationContext, connectionId: string, options: MessengerConnectOptions = {}): Promise<void> {
    const connection = this.repositories.getConnection(context, connectionId);
    if (connection.provider !== "whatsapp") throw new AppError("VALIDATION_ERROR", "The connection is not a WhatsApp connection.");
    this.clearReconnectTimer(connectionId);
    const previousSocket = this.sockets.get(connectionId);
    if (previousSocket) {
      this.sockets.delete(connectionId);
      previousSocket.end(undefined);
    }
    const credentialsPath = this.credentialsPath(context.userId, connectionId);
    mkdirSync(credentialsPath, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await useMultiFileAuthState(credentialsPath);
    this.repositories.updateConnection(context, connectionId, { status: "connecting", lastErrorCode: null, lastErrorMessage: null });
    const socket = makeWASocket({ auth: state, browser: Browsers.ubuntu("SkipTheVoice"), markOnlineOnConnect: false, syncFullHistory: true, generateHighQualityLinkPreview: false, logger: logger.child({ component: "baileys" }) as any });
    this.sockets.set(connectionId, socket);
    const connectionTimeout = setTimeout(() => {
      if (this.sockets.get(connectionId) !== socket) return;
      this.sockets.delete(connectionId);
      socket.end(new Error("WhatsApp connection timed out."));
      this.repositories.updateConnection(context, connectionId, { status: "reconnecting", lastErrorCode: "CONNECTION_TIMEOUT", lastErrorMessage: "The WhatsApp connection timed out and will be retried." });
      this.scheduleReconnect(context, connectionId, options);
    }, 30_000);
    connectionTimeout.unref();

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("contacts.upsert", (contacts) => {
      this.rememberContacts(context, connectionId, contacts);
      void this.linkContactAliases(context, connectionId, socket, contacts).then((linked) => this.refreshProfilePictures(context, connectionId, socket, linked.flatMap((contact) => [contact.phoneNumber, contact.id]).filter((value): value is string => Boolean(value))));
    });
    socket.ev.on("contacts.update", (contacts) => {
      this.rememberContacts(context, connectionId, contacts);
      void this.linkContactAliases(context, connectionId, socket, contacts).then((linked) => this.refreshProfilePictures(context, connectionId, socket, linked.flatMap((contact) => [contact.phoneNumber, contact.id]).filter((value): value is string => Boolean(value))));
    });
    socket.ev.on("chats.upsert", (chats) => this.rememberChats(context, connectionId, chats));
    socket.ev.on("chats.update", (chats) => this.rememberChats(context, connectionId, chats));
    socket.ev.on("connection.update", async (update) => {
      if (update.qr) {
        clearTimeout(connectionTimeout);
        this.authViews.set(connectionId, { qr: update.qr, updatedAt: now() });
        this.repositories.updateConnection(context, connectionId, { status: "waiting_for_qr" });
        options.onQr?.(update.qr);
      }
      if (update.connection === "open") {
        clearTimeout(connectionTimeout);
        this.authViews.delete(connectionId);
        this.repositories.updateConnection(context, connectionId, { status: "connected", externalAccountId: socket.user?.id?.split(":")[0] ?? null, lastConnectedAt: now(), lastErrorCode: null, lastErrorMessage: null });
        void this.refreshStoredProfilePictures(context, connectionId, socket);
        void this.refreshStoredGroups(context, connectionId, socket);
        logger.info({ connectionId }, "WhatsApp connection opened");
      }
      if (update.connection === "close") {
        clearTimeout(connectionTimeout);
        if (this.sockets.get(connectionId) !== socket) return;
        const code = (update.lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.sockets.delete(connectionId);
        this.repositories.updateConnection(context, connectionId, { status: loggedOut ? "disconnected" : "reconnecting", lastDisconnectedAt: now(), lastErrorCode: code ? String(code) : null, lastErrorMessage: loggedOut ? "WhatsApp signed out." : "The WhatsApp connection closed." });
        if (!loggedOut) this.scheduleReconnect(context, connectionId, options);
      }
    });
    socket.ev.on("messages.upsert", ({ messages }) => void this.importMessages(context, connectionId, socket, messages));
    socket.ev.on("messaging-history.set", ({ contacts, chats, messages }) => {
      this.rememberContacts(context, connectionId, contacts);
      this.rememberChats(context, connectionId, chats);
      void this.linkContactAliases(context, connectionId, socket, contacts).then((linked) => this.refreshProfilePictures(context, connectionId, socket, linked.flatMap((contact) => [contact.phoneNumber, contact.id]).filter((value): value is string => Boolean(value))));
      void this.importMessages(context, connectionId, socket, messages);
    });
    if (options.pairingCode && !state.creds.registered) {
      const phone = (options.phoneNumber ?? "").replace(/\D/g, "");
      if (!/^\d{8,15}$/.test(phone)) throw new AppError("VALIDATION_ERROR", "Provide a valid international phone number for pairing.");
      const pairingCode = await socket.requestPairingCode(phone);
      clearTimeout(connectionTimeout);
      this.authViews.set(connectionId, { pairingCode, updatedAt: now() });
      this.repositories.updateConnection(context, connectionId, { status: "waiting_for_pairing" });
      options.onPairingCode?.(pairingCode);
    }
  }

  async disconnect(context: ApplicationContext, connectionId: string): Promise<void> {
    this.repositories.assertOwns("messenger_connections", context.userId, connectionId);
    this.clearReconnectTimer(connectionId);
    const socket = this.sockets.get(connectionId);
    if (socket) {
      this.sockets.delete(connectionId);
      await socket.logout().catch(() => socket.end(undefined));
    }
    this.authViews.delete(connectionId);
    this.contacts.delete(connectionId);
    this.chatNames.delete(connectionId);
    this.avatarLookups.delete(connectionId);
    this.repositories.updateConnection(context, connectionId, { status: "disconnected", lastDisconnectedAt: now() });
  }

  async getConnectionStatus(context: ApplicationContext, connectionId: string): Promise<MessengerConnectionStatus> {
    return this.repositories.getConnection(context, connectionId).status as MessengerConnectionStatus;
  }

  async syncVoiceMessages(context: ApplicationContext, connectionId: string): Promise<SyncResult> {
    this.repositories.assertOwns("messenger_connections", context.userId, connectionId);
    const startedAt = now();
    if (!this.sockets.has(connectionId)) throw new AppError("CONNECTION_NOT_FOUND", "The WhatsApp connection is not active. Connect it before synchronizing.", 409);
    const completedAt = now();
    this.repositories.updateConnection(context, connectionId, { lastSyncAt: completedAt });
    return { connectionId, startedAt, completedAt, discovered: 0, imported: 0, duplicates: 0, downloaded: 0, failedDownloads: 0 };
  }

  async downloadVoiceMessage(context: ApplicationContext, voiceMessageId: string): Promise<DownloadedAudio> {
    const record = this.repositories.getVoiceMessage(context, voiceMessageId), message = this.messages.get(voiceMessageId), socket = this.sockets.get(record.connection_id);
    if (!message || !socket) throw new AppError("AUDIO_FILE_MISSING", "This media is no longer available in the active WhatsApp session. Synchronize again.");
    const buffer = await downloadMediaMessage(message, "buffer", {}, { logger: logger as any, reuploadRequest: socket.updateMediaMessage }) as Buffer;
    const destination = this.storage.originalPath(context.userId, record.connection_id, voiceMessageId, record.file_extension);
    const size = await this.storage.store(Readable.from(buffer), destination);
    this.repositories.sqlite.prepare("UPDATE voice_messages SET local_file_path=?,file_size=?,download_status='downloaded',download_error=NULL,updated_at=? WHERE id=? AND user_id=?").run(destination, size, now(), voiceMessageId, context.userId);
    return { filePath: destination, mimeType: record.mime_type, fileSize: size };
  }

  private async importMessages(context: ApplicationContext, connectionId: string, socket: WASocket, messages: WAMessage[]): Promise<void> {
    for (const message of messages) {
      try {
        if (message.key.fromMe || !message.key.id || !message.key.remoteJid) continue;
        const content = normalizeMessageContent(message.message);
        if (!isPttVoiceMessage(content as any)) continue;
        const existing = this.repositories.sqlite.prepare("SELECT id FROM voice_messages WHERE connection_id=? AND external_message_id=?").get(connectionId, message.key.id) as { id: string } | undefined;
        if (existing) continue;
        const audio = (content as any).audioMessage, voiceMessageId = id("vm"), senderJid = message.key.participant ?? message.key.participantAlt ?? message.key.remoteJid;
        const aliases = [...new Set([senderJid, message.key.participantAlt, message.key.remoteJidAlt].filter((value): value is string => Boolean(value)))];
        if (message.pushName || aliases.length > 1) {
          const lid = aliases.find((value) => value.endsWith("@lid"));
          const phoneNumber = aliases.find((value) => value.endsWith("@s.whatsapp.net"));
          this.rememberContacts(context, connectionId, [{ id: senderJid, ...(message.pushName ? { notify: message.pushName } : {}), ...(lid ? { lid } : {}), ...(phoneNumber ? { phoneNumber } : {}) }]);
        }
        const contact = aliases.map((alias) => this.contact(connectionId, alias)).find((value) => value !== undefined);
        const displayName = preferredWhatsAppName(contact, message.pushName, senderJid);
        void this.refreshProfilePictures(context, connectionId, socket, [contact?.phoneNumber, senderJid].filter((value): value is string => Boolean(value)));
        const isGroup = message.key.remoteJid.endsWith("@g.us");
        const conversationName = await this.conversationName(context, socket, connectionId, message.key.remoteJid, displayName, isGroup);
        const timestamp = now(), contactId = id("contact"), conversationId = id("conv");
        const mimeType = String(audio.mimetype ?? "audio/ogg").split(";")[0];
        const extension = mimeType === "audio/mpeg" ? "mp3" : mimeType === "audio/mp4" ? "m4a" : mimeType === "audio/webm" ? "webm" : "ogg";
        const phoneIdentifier = contact?.phoneNumber ?? aliases.find((value) => value.endsWith("@s.whatsapp.net"));
        const phoneNumber = phoneIdentifier ? whatsappIdentifierLabel(phoneIdentifier) : null;
        this.repositories.sqlite.transaction(() => {
          this.repositories.sqlite.prepare("INSERT OR IGNORE INTO contacts(id,user_id,connection_id,external_contact_id,display_name,phone_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(contactId, context.userId, connectionId, senderJid, displayName, phoneNumber, timestamp, timestamp);
          const storedContact = (this.repositories.sqlite.prepare("SELECT id FROM contacts WHERE connection_id=? AND external_contact_id=?").get(connectionId, senderJid) as { id: string }).id;
          this.repositories.sqlite.prepare("INSERT OR IGNORE INTO conversations(id,user_id,connection_id,external_chat_id,type,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(conversationId, context.userId, connectionId, message.key.remoteJid, isGroup ? "group" : "direct", conversationName, timestamp, timestamp);
          const conversation = (this.repositories.sqlite.prepare("SELECT id FROM conversations WHERE connection_id=? AND external_chat_id=?").get(connectionId, message.key.remoteJid) as { id: string }).id;
          const sentAt = new Date(Number(message.messageTimestamp) * 1000).toISOString();
          this.repositories.sqlite.prepare("INSERT INTO voice_messages(id,user_id,connection_id,conversation_id,contact_id,external_message_id,sender_external_id,sender_display_name,sent_at,duration_seconds,mime_type,file_extension,download_status,transcription_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(voiceMessageId, context.userId, connectionId, conversation, storedContact, message.key.id, senderJid, displayName, sentAt, Number(audio.seconds ?? 0), mimeType, extension, "pending", "not_started", timestamp, timestamp);
        })();
        this.messages.set(voiceMessageId, message);
        await this.downloadVoiceMessage(context, voiceMessageId);
        logger.info({ connectionId, voiceMessageId }, "Imported WhatsApp PTT voice message");
      } catch (error) {
        logger.error({ connectionId, error: error instanceof Error ? error.message : "Import failed" }, "WhatsApp message import failed");
      }
    }
  }
}
