import path from "node:path";
import { AppError } from "../errors.js";

export function safePathComponent(value: string): string {
  const sanitized = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.{2,}/g, ".").replace(/^-+|-+$/g, "");
  if (!sanitized || sanitized === "." || sanitized === "..") throw new AppError("AUDIO_FILE_INVALID", "A path component is invalid.");
  return sanitized.slice(0, 100);
}

export function resolveInside(root: string, ...components: string[]): string {
  const resolvedRoot = path.resolve(root), resolved = path.resolve(resolvedRoot, ...components.map(safePathComponent));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new AppError("FORBIDDEN", "The requested path is outside the storage directory.", 403);
  return resolved;
}

export function safeFilename(value: string, extension = ""): string {
  const base = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "voice-message";
  return `${base}${extension && !extension.startsWith(".") ? "." : ""}${extension}`;
}
