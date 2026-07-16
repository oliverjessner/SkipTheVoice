export interface NormalizedWhatsAppContent { audioMessage?: { ptt?: boolean | null; mimetype?: string | null; seconds?: number | null } | null }
export function isPttVoiceMessage(content: NormalizedWhatsAppContent | null | undefined): boolean { return content?.audioMessage?.ptt === true; }

export function unwrapMessageContent(message: any): any {
  let current = message;
  for (const key of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage"]) if (current?.[key]?.message) current = current[key].message;
  return current;
}
