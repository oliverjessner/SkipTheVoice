import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, databaseStatus, initializeDatabaseSchema, type DatabaseBundle } from "./connection.js";
import { Repositories, now } from "./repositories.js";
import { TranscriptionService } from "../transcription/service.js";

describe("SQLite repositories", () => {
  let database: DatabaseBundle;
  let repositories: Repositories;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabaseSchema(database.sqlite);
    repositories = new Repositories(database.sqlite);
    const timestamp = now();
    database.sqlite.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run("one", null, "One", timestamp, timestamp);
    database.sqlite.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run("two", null, "Two", timestamp, timestamp);
    database.sqlite.prepare("INSERT INTO messenger_connections(id,user_id,provider,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("conn", "one", "whatsapp", "Test", "connected", timestamp, timestamp);
    database.sqlite.prepare("INSERT INTO conversations(id,user_id,connection_id,external_chat_id,type,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("conv", "one", "conn", "external", "direct", "Test Contact", timestamp, timestamp);
    database.sqlite.prepare("INSERT INTO voice_messages(id,user_id,connection_id,conversation_id,external_message_id,sender_external_id,sender_display_name,sent_at,duration_seconds,mime_type,file_extension,file_size,local_file_path,download_status,transcription_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("vm", "one", "conn", "conv", "external-message", "test-sender", "Test Contact", timestamp, 2, "audio/wav", "wav", 10, "/tmp/audio.wav", "downloaded", "not_started", timestamp, timestamp);
  });

  afterEach(() => database.sqlite.close());

  it("bootstraps the final schema with foreign keys and a busy timeout", () => {
    const status = databaseStatus(database.sqlite);
    expect(status.schemaReady).toBe(true);
    expect(status.tableCount).toBe(11);
    expect(status.foreignKeys).toBe(true);
    expect(["memory", "wal"]).toContain(status.journalMode);
    expect(status.busyTimeout).toBe(5000);
  });

  it("enforces ownership in repositories", () => {
    expect(() => repositories.getVoiceMessage({ userId: "two" }, "vm")).toThrow(/access/);
    expect(repositories.getVoiceMessage({ userId: "one" }, "vm").id).toBe("vm");
  });

  it("stores, updates, and removes an optional voice message name", () => {
    expect(repositories.setVoiceMessageName({ userId: "one" }, "vm", "  Follow up  ")).toEqual({ id: "vm", name: "Follow up" });
    expect(repositories.listVoiceMessages({ userId: "one" })).toEqual([expect.objectContaining({ id: "vm", name: "Follow up" })]);
    expect(repositories.setVoiceMessageName({ userId: "one" }, "vm", "")).toEqual({ id: "vm", name: null });
    expect(repositories.listVoiceMessages({ userId: "one" })).toEqual([expect.objectContaining({ id: "vm", name: null })]);
    expect(() => repositories.setVoiceMessageName({ userId: "two" }, "vm", "Not allowed")).toThrow(/access/);
  });

  it("searches voice messages by transcript, partial text, title, and sender", () => {
    const timestamp = now();
    const job = new TranscriptionService(repositories).start({ userId: "one" }, "vm");
    database.sqlite.prepare("UPDATE transcription_jobs SET partial_text=? WHERE id=?").run("Zwischenstand über Bananen", job.id);
    database.sqlite.prepare(`INSERT INTO transcriptions(id,user_id,voice_message_id,transcription_job_id,provider,model,detected_language,text,duration_milliseconds,audio_duration_seconds,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run("transcript", "one", "vm", job.id, "self_hosted_whisper", "tiny", "de", "Das geheime Projekt startet morgen.", 100, 2, timestamp, timestamp);
    repositories.setVoiceMessageName({ userId: "one" }, "vm", "Wochenplanung");

    for (const search of ["GEHEIME", "Bananen", "Wochenplanung", "test contact"]) {
      expect(repositories.listVoiceMessages({ userId: "one" }, { search })).toEqual([expect.objectContaining({ id: "vm" })]);
    }
    expect(repositories.listVoiceMessages({ userId: "one" }, { search: "nicht vorhanden" })).toEqual([]);
    expect(repositories.listVoiceMessages({ userId: "one" }, { search: "%" })).toEqual([]);
  });

  it("maps model loading progress to the persisted preparing status", () => {
    const service = new TranscriptionService(repositories);
    const job = service.start({ userId: "one" }, "vm");
    service.persistProgress(job.id, { phase: "loading_model", progressType: "indeterminate", elapsedMilliseconds: 100, sequence: 1, updatedAt: now() });
    expect(repositories.getJob({ userId: "one" }, job.id)).toMatchObject({ status: "preparing", progressPhase: "loading_model" });
    expect(repositories.getVoiceMessage({ userId: "one" }, "vm").transcription_status).toBe("preparing");
  });

  it("deduplicates external messages and cascades jobs", () => {
    const duplicate = () => database.sqlite.prepare("INSERT INTO voice_messages SELECT 'vm2',user_id,connection_id,conversation_id,contact_id,external_message_id,sender_external_id,sender_display_name,sent_at,duration_seconds,mime_type,file_extension,file_size,local_file_path,download_status,transcription_status,created_at,updated_at FROM voice_messages WHERE id='vm'").run();
    expect(duplicate).toThrow();
    const job = new TranscriptionService(repositories).start({ userId: "one" }, "vm");
    expect(() => new TranscriptionService(repositories).start({ userId: "one" }, "vm")).toThrow(/already active/);
    repositories.deleteVoiceMessage({ userId: "one" }, "vm");
    expect(database.sqlite.prepare("SELECT 1 FROM transcription_jobs WHERE id=?").get(job.id)).toBeUndefined();
  });
});
