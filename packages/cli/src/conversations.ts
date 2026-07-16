import { constants, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  AppError,
  JobRunner,
  localIsoTimestamp,
  safeFilename,
  type ApplicationContext,
  type SkipTheVoiceApplication,
  type TranscriptionProgress,
} from "@skipthevoice/core";
import { ensureWhisperWorker } from "./runtime.js";

export interface ConversationRow {
  id: string;
  displayName: string;
  type: string;
  voiceMessageCount: number;
  latestVoiceMessageAt: string;
}

export interface VoiceMessageRow {
  id: string;
  name?: string | null;
  senderName: string;
  sentAt: string;
  durationSeconds: number;
  downloadStatus: string;
  transcriptionStatus: string;
  transcript?: string | null;
  detectedLanguage?: string | null;
  jobId?: string | null;
  jobStatus?: string | null;
}

export interface ConversationCommandOptions {
  output?: boolean;
  markdown?: boolean;
  downloadAudio?: boolean;
  force?: boolean;
  language?: string;
  json?: boolean;
}

export interface CliIO {
  out(value: string): void;
  progress(value: string): void;
}

const defaultIO: CliIO = {
  out: (value) => console.log(value),
  progress: (value) => console.error(value),
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export function formatDate(value: string, includeSeconds = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(new Date(value));
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

export function formatStatus(value: string): string {
  if (value === "processing") return "Transcribing";
  const label = value.replaceAll("_", " ").toLocaleLowerCase();
  return `${label[0]?.toLocaleUpperCase() ?? ""}${label.slice(1)}`;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)));
  return [headers, ...rows].map((row) => row.map((value, column) => value.padEnd(widths[column] ?? value.length)).join("  ").trimEnd()).join("\n");
}

function ambiguous(kind: string, selector: string, names: string[]): never {
  throw new AppError(
    "VALIDATION_ERROR",
    `Multiple ${kind} matched "${selector}":\n\n${names.map((name, index) => `${index + 1}. ${name}`).join("\n")}\n\nPlease use the complete name or ${kind === "conversations" ? "conversation" : "message"} ID.`,
    400,
  );
}

export function matchConversation(rows: ConversationRow[], selector: string): ConversationRow {
  const query = normalize(selector);
  const byId = rows.find((row) => normalize(row.id) === query);
  if (byId) return byId;
  const exact = rows.filter((row) => normalize(row.displayName) === query);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) ambiguous("conversations", selector, exact.map((row) => row.displayName));
  const partial = rows.filter((row) => normalize(row.displayName).includes(query) || normalize(row.id).startsWith(query));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) ambiguous("conversations", selector, partial.map((row) => row.displayName));
  throw new AppError("VALIDATION_ERROR", `No conversation matched "${selector}".`, 404);
}

function messageLabel(row: VoiceMessageRow): string {
  return row.name ? `${row.name} (${row.id})` : `${formatDate(row.sentAt)} (${row.id})`;
}

export function matchMessage(rows: VoiceMessageRow[], selector: string): VoiceMessageRow {
  const query = normalize(selector);
  const byId = rows.find((row) => normalize(row.id) === query);
  if (byId) return byId;
  const exact = rows.filter((row) => normalize(row.name ?? "") === query || normalize(formatDate(row.sentAt)) === query || normalize(row.sentAt) === query);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) ambiguous("messages", selector, exact.map(messageLabel));
  const partial = rows.filter((row) => normalize(row.name ?? "").includes(query) || normalize(row.id).startsWith(query));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) ambiguous("messages", selector, partial.map(messageLabel));
  throw new AppError("VALIDATION_ERROR", `No voice message matched "${selector}".`, 404);
}

async function allVoiceMessages(app: SkipTheVoiceApplication, context: ApplicationContext, conversationId: string): Promise<VoiceMessageRow[]> {
  const rows: VoiceMessageRow[] = [];
  while (true) {
    const page = app.listVoiceMessages(context, { conversationId, limit: 100, offset: rows.length }) as VoiceMessageRow[];
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

function details(conversation: ConversationRow, message: VoiceMessageRow): string {
  const language = message.detectedLanguage
    ? new Intl.DisplayNames(["en"], { type: "language" }).of(message.detectedLanguage) ?? message.detectedLanguage
    : "Unknown";
  const fields: [string, string][] = [
    ["ID", message.id],
    ["Conversation", conversation.displayName],
    ["Sender", message.senderName],
    ["Date", formatDate(message.sentAt)],
    ["Duration", formatDuration(message.durationSeconds)],
    ["Audio status", formatStatus(message.downloadStatus)],
    ["Transcription status", formatStatus(message.transcriptionStatus)],
    ["Language", language],
  ];
  const width = Math.max(...fields.map(([label]) => label.length + 1)) + 3;
  return `Voice message\n\n${fields.map(([label, value]) => `${`${label}:`.padEnd(width)}${value}`).join("\n")}`;
}

function renderProgress(progress: Pick<TranscriptionProgress, "phase" | "percent" | "processedAudioSeconds" | "totalAudioSeconds" | "estimatedRemainingSeconds">, io: CliIO): void {
  const labels: Record<string, string> = {
    queued: "Queued",
    preparing_audio: "Preparing audio",
    loading_model: "Preparing model",
    transcribing: "Transcribing",
    finalizing: "Finalizing transcript",
    completed: "Completed",
  };
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent ?? 0)));
  const filled = Math.round(percent / 5);
  const lines = [`${labels[progress.phase] ?? formatStatus(progress.phase)}`, `[${"█".repeat(filled)}${"░".repeat(20 - filled)}] ${percent}%`];
  if (progress.processedAudioSeconds != null && progress.totalAudioSeconds != null) lines.push(`Processed: ${Math.round(progress.processedAudioSeconds)}s of ${Math.round(progress.totalAudioSeconds)}s`);
  if (progress.estimatedRemainingSeconds != null) lines.push(`Estimated time remaining: ${Math.round(progress.estimatedRemainingSeconds)}s`);
  io.progress(lines.join("\n") + "\n");
}

async function ensureTranscript(
  app: SkipTheVoiceApplication,
  context: ApplicationContext,
  conversation: ConversationRow,
  selected: VoiceMessageRow,
  options: ConversationCommandOptions,
  io: CliIO,
): Promise<VoiceMessageRow> {
  if (selected.transcript && !options.force) return selected;
  const managedWorker = await ensureWhisperWorker(app);
  try {
    let job = !options.force && selected.jobId && ["queued", "preparing", "processing", "finalizing"].includes(selected.jobStatus ?? "")
      ? app.getJob(context, selected.jobId)
      : app.startTranscription(context, selected.id, options.language ? { language: options.language } : {});
    let lastPhase = "";
    let lastPercent = -10;
    const show = (progress: TranscriptionProgress) => {
      if (options.json || progress.phase === lastPhase && Math.round(progress.percent ?? 0) - lastPercent < 5) return;
      lastPhase = progress.phase;
      lastPercent = Math.round(progress.percent ?? 0);
      renderProgress(progress, io);
    };
    const runner = new JobRunner(app.repositories, app.whisper, (jobId, progress) => { if (jobId === job.id) show(progress); });
    runner.recoverStale();
    while (!["completed", "failed", "cancelled"].includes(job.status)) {
      if (job.status === "queued") await runner.processOne(job.id);
      else await delay(500);
      job = app.getJob(context, job.id);
      show({
        phase: job.progressPhase,
        progressType: job.progressType,
        percent: job.progressPercent,
        processedAudioSeconds: job.processedAudioSeconds,
        totalAudioSeconds: job.totalAudioSeconds,
        estimatedRemainingSeconds: job.estimatedRemainingSeconds,
        elapsedMilliseconds: job.elapsedMilliseconds,
        sequence: 0,
        updatedAt: job.updatedAt,
      });
    }
    if (job.status !== "completed") throw new AppError("TRANSCRIPTION_FAILED", job.errorMessage ?? `Transcription ${job.status}.`, 500);
    const refreshed = await allVoiceMessages(app, context, conversation.id);
    const message = refreshed.find((row) => row.id === selected.id);
    if (!message?.transcript) throw new AppError("TRANSCRIPTION_FAILED", "The transcription completed without a transcript.", 500);
    return message;
  } finally {
    await managedWorker?.stop();
  }
}

function downloadAudio(app: SkipTheVoiceApplication, context: ApplicationContext, conversation: ConversationRow, message: VoiceMessageRow): string {
  const audio = app.audio(context, message.id);
  const extension = path.extname(audio.filename).slice(1);
  const filename = safeFilename(`${message.sentAt.slice(0, 10)}-${conversation.displayName}-${message.id}`, extension);
  const destination = path.resolve(filename);
  if (existsSync(destination)) throw new AppError("VALIDATION_ERROR", `The output file already exists: ${filename}`, 409);
  copyFileSync(audio.path, destination, constants.COPYFILE_EXCL);
  return destination;
}

export async function runConversations(
  app: SkipTheVoiceApplication,
  context: ApplicationContext,
  conversationSelector: string | undefined,
  messageSelector: string | undefined,
  options: ConversationCommandOptions,
  io: CliIO = defaultIO,
): Promise<void> {
  if (options.output && options.markdown) throw new AppError("VALIDATION_ERROR", "Use either --output or --markdown, not both.", 400);
  if (!messageSelector && (options.output || options.markdown || options.downloadAudio || options.force || options.language)) throw new AppError("VALIDATION_ERROR", "Select a voice message before using output options.", 400);
  const conversations = app.listConversations(context) as ConversationRow[];
  if (!conversationSelector) {
    if (options.json) return io.out(JSON.stringify({ conversations }, null, 2));
    const rows = conversations.map((row) => [row.displayName, formatStatus(row.type), String(row.voiceMessageCount), formatDate(row.latestVoiceMessageAt, false)]);
    return io.out(`Conversations\n\n${formatTable(["NAME", "TYPE", "AUDIOS", "LAST AUDIO"], rows)}`);
  }
  const conversation = matchConversation(conversations, conversationSelector);
  const messages = await allVoiceMessages(app, context, conversation.id);
  if (!messageSelector) {
    if (options.json) return io.out(JSON.stringify({ conversation: { id: conversation.id, name: conversation.displayName, type: conversation.type }, voiceMessages: messages.map(({ id, sentAt, durationSeconds, name, transcriptionStatus }) => ({ id, sentAt: localIsoTimestamp(sentAt), durationSeconds, name: name ?? null, transcriptionStatus })) }, null, 2));
    const rows = messages.map((row) => [row.id, formatDate(row.sentAt), formatDuration(row.durationSeconds), row.name ?? "—", formatStatus(row.transcriptionStatus)]);
    return io.out(`${conversation.displayName}\n\n${formatTable(["ID", "DATE", "DURATION", "NAME", "STATUS"], rows)}`);
  }
  let message = matchMessage(messages, messageSelector);
  if (options.downloadAudio) {
    const destination = downloadAudio(app, context, conversation, message);
    const shown = `.${path.sep}${path.basename(destination)}`;
    if (options.json && !options.output && !options.markdown) return io.out(JSON.stringify({ path: destination }));
    if (options.output || options.markdown) io.progress(`Audio saved to:\n${shown}\n`);
    else return io.out(`Audio saved to:\n${shown}`);
  }
  if (options.output || options.markdown) {
    message = await ensureTranscript(app, context, conversation, message, options, io);
    if (options.json) return io.out(JSON.stringify({ id: message.id, transcript: message.transcript, format: options.markdown ? "markdown" : "text" }, null, 2));
    if (options.markdown) return io.out(app.exportMarkdown(context, message.id).content.trimEnd());
    return io.out(message.transcript!.trim());
  }
  if (options.json) return io.out(JSON.stringify({ conversation: { id: conversation.id, name: conversation.displayName, type: conversation.type }, voiceMessage: message }, null, 2));
  io.out(details(conversation, message));
}
