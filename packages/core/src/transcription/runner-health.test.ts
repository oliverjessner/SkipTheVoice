import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, initializeDatabaseSchema, type DatabaseBundle } from "../database/connection.js";
import { Repositories } from "../database/repositories.js";
import { transcriptionRunnerHealth } from "./runner.js";

describe("transcription runner health", () => {
  let database: DatabaseBundle;
  let repositories: Repositories;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabaseSchema(database.sqlite);
    repositories = new Repositories(database.sqlite);
  });

  afterEach(() => database.sqlite.close());

  it("distinguishes a live heartbeat from a stale runner", () => {
    const timestamp = "2026-07-16T12:00:00.000Z";
    database.sqlite.prepare("INSERT INTO worker_heartbeats(worker_id,worker_type,started_at,heartbeat_at) VALUES(?,?,?,?)").run("runner-1", "transcription", timestamp, timestamp);
    expect(transcriptionRunnerHealth(repositories, Date.parse(timestamp) + 5_000)).toMatchObject({ healthy: true, workerCount: 1, lastHeartbeatAt: timestamp });
    expect(transcriptionRunnerHealth(repositories, Date.parse(timestamp) + 20_000)).toMatchObject({ healthy: false, workerCount: 0, lastHeartbeatAt: timestamp });
  });
});
