"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Progress } from "./Progress";

interface Conversation {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  voiceMessageCount: number;
  latestVoiceMessageAt: string;
}

interface AudioRecord {
  id: string;
  name?: string | null;
  senderName: string;
  senderAvatarUrl?: string | null;
  sentAt: string;
  durationSeconds: number;
  transcriptionStatus: string;
  jobId?: string | null;
  jobStatus?: string | null;
  partialText?: string | null;
  transcript?: string | null;
  [key: string]: unknown;
}

interface ServiceHealth {
  nodeRunner: { healthy: boolean; queued: number };
  whisperWorker: { healthy: boolean };
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "The request failed.");
  return body;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : name.slice(0, 2)).toUpperCase();
}

function durationLabel(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 60) return `${seconds} Sek.`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Min.`;
}

function statusLabel(value: string): string {
  return ({
    not_started: "Nicht transkribiert",
    queued: "In Warteschlange",
    preparing: "Wird vorbereitet",
    processing: "Wird transkribiert",
    finalizing: "Wird abgeschlossen",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function Avatar({ name, url }: { name: string; url: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="avatar" aria-hidden="true">
    {url && !failed
      ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : initials(name)}
  </span>;
}

export default function AudiosClient() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState("");
  const [audios, setAudios] = useState<AudioRecord[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth>();
  const [editingNameId, setEditingNameId] = useState<string>();
  const [nameDraft, setNameDraft] = useState("");
  const [savingNameId, setSavingNameId] = useState<string>();
  const [copiedTranscriptId, setCopiedTranscriptId] = useState<string>();

  const loadConversations = useCallback(async () => {
    try {
      const rows = await request(`/api/conversations?search=${encodeURIComponent(search)}`) as Conversation[];
      setConversations(rows);
      setSelected((value) => value || rows[0]?.id || "");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadAudios = useCallback(async () => {
    if (!selected) return;
    try {
      setAudios(await request(`/api/audios?conversationId=${encodeURIComponent(selected)}`) as AudioRecord[]);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [selected]);

  const loadServiceHealth = useCallback(async () => {
    try {
      setServiceHealth(await request("/api/health") as ServiceHealth);
    } catch {
      setServiceHealth({ nodeRunner: { healthy: false, queued: 0 }, whisperWorker: { healthy: false } });
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const timer = setInterval(() => void loadConversations(), 5_000);
    return () => clearInterval(timer);
  }, [loadConversations]);

  useEffect(() => {
    void loadAudios();
    const timer = setInterval(() => void loadAudios(), 5_000);
    return () => clearInterval(timer);
  }, [loadAudios]);

  useEffect(() => {
    void loadServiceHealth();
    const timer = setInterval(() => void loadServiceHealth(), 5_000);
    return () => clearInterval(timer);
  }, [loadServiceHealth]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadConversations();
      void loadAudios();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadAudios, loadConversations]);

  useEffect(() => {
    const jobs = audios.filter((audio) => audio.jobId && !["completed", "failed", "cancelled"].includes(audio.jobStatus ?? ""));
    if (!jobs.length) return;
    const sources = jobs.map((audio) => {
      const source = new EventSource(`/api/transcriptions/${audio.jobId}/events`);
      source.onmessage = () => void loadAudios();
      source.addEventListener("transcription.progress", () => void loadAudios());
      source.onerror = () => source.close();
      return source;
    });
    const fallback = setInterval(() => void loadAudios(), 1_000);
    return () => {
      sources.forEach((source) => source.close());
      clearInterval(fallback);
    };
  }, [audios.map((audio) => `${audio.jobId}:${audio.jobStatus}`).join(","), loadAudios]);

  async function action(url: string, body?: unknown) {
    setError("");
    try {
      await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      await loadAudios();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  function editName(audio: AudioRecord) {
    setEditingNameId(audio.id);
    setNameDraft(audio.name ?? "");
  }

  async function saveName(event: FormEvent<HTMLFormElement>, audioId: string) {
    event.preventDefault();
    setError("");
    setSavingNameId(audioId);
    try {
      const result = await request(`/api/audios/${audioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameDraft.trim() || null }),
      }) as { name: string | null };
      setAudios((rows) => rows.map((audio) => audio.id === audioId ? { ...audio, name: result.name } : audio));
      setEditingNameId(undefined);
      setNameDraft("");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSavingNameId(undefined);
    }
  }

  async function copyTranscript(audio: AudioRecord) {
    if (!audio.transcript) return;
    try {
      await navigator.clipboard.writeText(audio.transcript);
      setCopiedTranscriptId(audio.id);
      window.setTimeout(() => setCopiedTranscriptId((value) => value === audio.id ? undefined : value), 2_000);
    } catch {
      setError("Das Transkript konnte nicht in die Zwischenablage kopiert werden.");
    }
  }

  const filtered = useMemo(() => conversations, [conversations]);
  const transcriptionUnavailable = Boolean(serviceHealth && (!serviceHealth.nodeRunner.healthy || !serviceHealth.whisperWorker.healthy));
  return <>
    <h1 className="page-title">Audios</h1>
    <p className="lede">Only received push-to-talk voice messages appear here.</p>
    {error && <div className="error" role="alert">{error} <button className="button" onClick={() => { void loadConversations(); void loadAudios(); }}>Retry</button></div>}
    {transcriptionUnavailable && <div className="error" role="status">Transcription services are unavailable. Restart SkipTheVoice. Queued jobs will resume automatically.</div>}
    <div className="panel audio-grid">
      <section className="conversation-pane" aria-label="Conversations">
        <label className="field">
          <span className="sr-only">Search conversations</span>
          <input className="search" type="search" placeholder="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {loading
          ? <div className="empty">Loading voice messages…</div>
          : filtered.length === 0
            ? <div className="empty">No voice messages found</div>
            : <ul className="conversation-list">{filtered.map((row) => <li key={row.id}>
              <button className="conversation-button" data-selected={selected === row.id} onClick={() => setSelected(row.id)}>
                <Avatar name={row.displayName} url={row.avatarUrl} />
                <span className="conversation-copy">
                  <span className="conversation-name">{row.displayName}</span>
                  <span className="meta">{row.voiceMessageCount} voice {row.voiceMessageCount === 1 ? "message" : "messages"} · {new Date(row.latestVoiceMessageAt).toLocaleDateString()}</span>
                </span>
              </button>
            </li>)}</ul>}
      </section>
      <section className="detail-pane" aria-label="Voice messages">
        {!selected
          ? <div className="empty">Select a conversation to view its voice messages.</div>
          : audios.length === 0
            ? <div className="empty">No voice messages found</div>
            : <ul className="voice-list">{audios.map((audio) => <li className="voice-card" key={audio.id}>
              <header className="voice-card-header">
                <div className="sender">
                  <Avatar name={audio.senderName} url={audio.senderAvatarUrl} />
                  <div className="sender-copy">
                    <strong>{audio.senderName}</strong>
                    <div className="meta"><time dateTime={audio.sentAt}>{new Date(audio.sentAt).toLocaleString("de-DE")}</time> · {durationLabel(audio.durationSeconds)}</div>
                  </div>
                </div>
                <span className="status voice-status" data-status={audio.transcriptionStatus}>{statusLabel(audio.transcriptionStatus)}</span>
              </header>
              <div className="voice-card-player">
                <audio controls preload="metadata" src={`/api/audios/${audio.id}/stream`}>Dein Browser unterstützt die Audiowiedergabe nicht.</audio>
              </div>
              {audio.jobId && !["completed", "failed", "cancelled"].includes(audio.jobStatus ?? "") && <Progress job={audio} />}
              {audio.partialText && audio.jobStatus !== "completed" && <section className="voice-transcript" aria-labelledby={`partial-${audio.id}`}>
                <h3 id={`partial-${audio.id}`}>Vorläufiges Transkript</h3>
                <div className="partial">{audio.partialText}</div>
              </section>}
              {audio.transcript && <section className="voice-transcript" aria-labelledby={`transcript-${audio.id}`}>
                <h3 id={`transcript-${audio.id}`}>Transkript</h3>
                <div className="transcript">{audio.transcript}</div>
              </section>}
              <footer className="voice-card-footer">
                <div className="voice-title-block">
                  <span className="voice-footer-label">Titel</span>
                {editingNameId === audio.id
                  ? <form className="voice-title-form" onSubmit={(event) => void saveName(event, audio.id)}>
                    <label className="sr-only" htmlFor={`message-name-${audio.id}`}>Titel der Sprachnachricht</label>
                    <input id={`message-name-${audio.id}`} className="voice-title-input" autoFocus maxLength={120} placeholder="Optionaler Titel" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
                    <button className="inline-action" disabled={savingNameId === audio.id} type="submit">{savingNameId === audio.id ? "Speichert…" : "Speichern"}</button>
                    <button className="inline-action" disabled={savingNameId === audio.id} type="button" onClick={() => { setEditingNameId(undefined); setNameDraft(""); }}>Abbrechen</button>
                  </form>
                  : <div className="voice-title-row">
                    <strong>{audio.name || "Ohne Titel"}</strong>
                    <button className="inline-action" type="button" onClick={() => editName(audio)}>{audio.name ? "Umbenennen" : "Titel hinzufügen"}</button>
                  </div>}
                </div>
                <div className="voice-footer-actions">
                  {!audio.jobId && <button className="button primary" disabled={transcriptionUnavailable} onClick={() => void action("/api/transcriptions", { voiceMessageId: audio.id })}>Transkribieren</button>}
                  {audio.jobStatus && ["failed", "cancelled"].includes(audio.jobStatus) && <button className="button primary" disabled={transcriptionUnavailable} onClick={() => void action(`/api/transcriptions/${audio.jobId}/retry`)}>Erneut transkribieren</button>}
                  {audio.jobId && !["completed", "failed", "cancelled"].includes(audio.jobStatus ?? "") && <button className="button danger" onClick={() => void action(`/api/transcriptions/${audio.jobId}/cancel`)}>Transkription abbrechen</button>}
                  {audio.transcript && <button className="button primary" onClick={() => void copyTranscript(audio)}>{copiedTranscriptId === audio.id ? "Kopiert" : "Transkript kopieren"}</button>}
                  {audio.transcript && <a className="button" href={`/api/audios/${audio.id}/markdown`}>Markdown herunterladen</a>}
                </div>
              </footer>
            </li>)}</ul>}
      </section>
    </div>
  </>;
}
