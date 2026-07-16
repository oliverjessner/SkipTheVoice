import { pino } from "pino";
import { getConfig } from "./config.js";

export const logger = pino({
  level: getConfig().logLevel,
  redact: ["token", "internalToken", "credentials", "qr", "pairingCode", "text", "transcript", "filePath"],
  base: { service: "skipthevoice" },
}, pino.destination(2));

export function maskSecret(secret: string): string {
  if (!secret) return "(not configured)";
  return `••••••••••••${secret.length > 4 ? secret.slice(-4) : ""}`;
}
