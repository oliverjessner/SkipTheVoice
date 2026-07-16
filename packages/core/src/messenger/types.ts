import type { ApplicationContext } from "../context.js";

export type MessengerConnectionStatus = "disconnected" | "connecting" | "waiting_for_qr" | "waiting_for_pairing" | "connected" | "reconnecting" | "error";
export interface MessengerConnectOptions { qr?: boolean; pairingCode?: boolean; phoneNumber?: string; onQr?: (qr: string) => void; onPairingCode?: (code: string) => void }
export interface SyncResult { connectionId: string; startedAt: string; completedAt: string; discovered: number; imported: number; duplicates: number; downloaded: number; failedDownloads: number }
export interface DownloadedAudio { filePath: string; mimeType: string; fileSize: number }
export interface MessengerProvider {
  readonly providerType: string;
  connect(context: ApplicationContext, connectionId: string, options?: MessengerConnectOptions): Promise<void>;
  disconnect(context: ApplicationContext, connectionId: string): Promise<void>;
  getConnectionStatus(context: ApplicationContext, connectionId: string): Promise<MessengerConnectionStatus>;
  syncVoiceMessages(context: ApplicationContext, connectionId: string): Promise<SyncResult>;
  downloadVoiceMessage(context: ApplicationContext, voiceMessageId: string): Promise<DownloadedAudio>;
}
