import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatDate,
  formatStatus,
  formatTable,
  matchConversation,
  matchMessage,
  type ConversationRow,
  type VoiceMessageRow,
} from "./conversations.js";

const conversations: ConversationRow[] = [
  { id: "conversation_one", displayName: "Muhammed Akman", type: "direct", voiceMessageCount: 2, latestVoiceMessageAt: "2026-07-16T11:50:52Z" },
  { id: "conversation_two", displayName: "Muhammed Kaya", type: "direct", voiceMessageCount: 1, latestVoiceMessageAt: "2026-07-15T16:21:00Z" },
];

const messages: VoiceMessageRow[] = [
  { id: "vm_a81f", name: "Long message", senderName: "Muhammed Akman", sentAt: "2026-07-16T11:50:52Z", durationSeconds: 134, downloadStatus: "downloaded", transcriptionStatus: "completed" },
  { id: "vm_b92d", name: "Long message", senderName: "Muhammed Akman", sentAt: "2026-07-16T09:32:10Z", durationSeconds: 24, downloadStatus: "downloaded", transcriptionStatus: "not_started" },
];

describe("conversation CLI formatting and matching", () => {
  it("formats durations, statuses, and aligned text tables", () => {
    expect(formatDuration(134)).toBe("02:14");
    expect(formatStatus("not_started")).toBe("Not started");
    expect(formatStatus("processing")).toBe("Transcribing");
    expect(formatTable(["NAME", "TYPE"], [["Anna", "Direct"], ["Project Team", "Group"]])).toContain("NAME          TYPE");
  });

  it("matches conversations case-insensitively by full name, partial name, and ID", () => {
    expect(matchConversation(conversations, "muhammed akman").id).toBe("conversation_one");
    expect(matchConversation(conversations, "Akman").id).toBe("conversation_one");
    expect(matchConversation(conversations, "conversation_two").displayName).toBe("Muhammed Kaya");
    expect(() => matchConversation(conversations, "Muhammed")).toThrow(/Multiple conversations matched/);
  });

  it("matches voice messages by ID and local timestamp without guessing duplicate names", () => {
    expect(matchMessage(messages, "vm_a81f").name).toBe("Long message");
    expect(matchMessage(messages, formatDate(messages[0]!.sentAt)).id).toBe("vm_a81f");
    expect(() => matchMessage(messages, "long message")).toThrow(/Multiple messages matched/);
  });
});
