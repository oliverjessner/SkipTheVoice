import { safeFilename } from "../security/paths.js";

export interface MarkdownTranscript { id: string; sender: string; conversation: string; messenger: string; date: string; durationSeconds: number; language?: string; engine: string; model: string; text: string }
const quote = (value: string) => JSON.stringify(value.replace(/[\r\n]+/g, " "));
export function localIsoTimestamp(value: string): string {
  const date = new Date(value);
  const offsetMinutes = -date.getTimezoneOffset();
  const local = new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 19);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${local}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
export function generateMarkdown(input: MarkdownTranscript): string {
  if (!input.text.trim()) throw new Error("A completed transcript is required for Markdown export.");
  return `---\nid: ${quote(input.id)}\nmessenger: ${quote(input.messenger)}\nconversation: ${quote(input.conversation)}\nsender: ${quote(input.sender)}\ndate: ${quote(input.date)}\nduration_seconds: ${Math.round(input.durationSeconds)}\nlanguage: ${quote(input.language ?? "unknown")}\ntranscription_engine: ${quote(input.engine)}\nmodel: ${quote(input.model)}\n---\n\n# Voice message from ${input.sender}\n\n${input.text.trim()}\n`;
}
export function markdownFilename(date: string, sender: string): string { return safeFilename(`${date.slice(0, 10)}-${sender}-voice-message`, "md"); }
