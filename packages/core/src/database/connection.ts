import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../config.js";
import * as schema from "./schema.js";

export type SqliteDatabase = Database.Database;
export interface DatabaseBundle { sqlite: SqliteDatabase; db: any }
let singleton: DatabaseBundle | undefined;

export function createDatabase(databasePath = getConfig().databasePath): DatabaseBundle {
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma(`busy_timeout = ${getConfig().sqliteBusyTimeoutMs}`);
  sqlite.pragma("synchronous = NORMAL");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function getDatabase(): DatabaseBundle { return singleton ??= createDatabase(); }
export function closeDatabase(): void { singleton?.sqlite.close(); singleton = undefined; }

export function initializeDatabaseSchema(sqlite: SqliteDatabase = getDatabase().sqlite): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.SKIPTHEVOICE_SCHEMA_PATH, path.join(currentDir, "schema.sql"), path.join(currentDir, "database", "schema.sql"), path.resolve("packages/core/src/database/schema.sql")].filter((candidate): candidate is string => Boolean(candidate));
  const schemaPath = candidates.find((candidate) => { try { readFileSync(candidate); return true; } catch { return false; } });
  if (!schemaPath) throw new Error("Database bootstrap schema was not found.");
  sqlite.exec(readFileSync(schemaPath, "utf8"));
}

export function databaseStatus(sqlite: SqliteDatabase = getDatabase().sqlite): { schemaReady: boolean; tableCount: number; journalMode: string; foreignKeys: boolean; busyTimeout: number } {
  const tableCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number }).count;
  return {
    schemaReady: Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()),
    tableCount,
    journalMode: String(sqlite.pragma("journal_mode", { simple: true })),
    foreignKeys: Number(sqlite.pragma("foreign_keys", { simple: true })) === 1,
    busyTimeout: Number(sqlite.pragma("busy_timeout", { simple: true })),
  };
}
