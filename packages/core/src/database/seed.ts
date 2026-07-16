import { getConfig } from "../config.js";
import { now, Repositories } from "./repositories.js";

export function seedDatabase(repositories: Repositories, userId = getConfig().defaultUserId): { userId: string } {
  const timestamp = now();
  repositories.sqlite.prepare(
    "INSERT OR IGNORE INTO users(id,email,name,created_at,updated_at) VALUES(?,?,?,?,?)",
  ).run(userId, "developer@example.invalid", "Local developer", timestamp, timestamp);
  return { userId };
}
