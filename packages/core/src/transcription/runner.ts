import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Repositories, now } from "../database/repositories.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { isStale } from "./progress.js";
import { TranscriptionService } from "./service.js";
import type { TranscriptionProvider } from "./types.js";

const heartbeatIntervalMs = 5_000;
const healthyHeartbeatAgeMs = 15_000;

export function transcriptionRunnerHealth(repositories: Repositories, currentTime = Date.now()): { healthy: boolean; workerCount: number; lastHeartbeatAt: string | null } {
  const rows = repositories.sqlite.prepare("SELECT heartbeat_at AS heartbeatAt FROM worker_heartbeats WHERE worker_type='transcription' ORDER BY heartbeat_at DESC").all() as { heartbeatAt: string }[];
  const lastHeartbeatAt = rows[0]?.heartbeatAt ?? null;
  return {
    healthy: Boolean(lastHeartbeatAt && currentTime - new Date(lastHeartbeatAt).getTime() <= healthyHeartbeatAgeMs),
    workerCount: rows.filter((row) => currentTime - new Date(row.heartbeatAt).getTime() <= healthyHeartbeatAgeMs).length,
    lastHeartbeatAt,
  };
}

export class JobRunner {
  private stopping = false; readonly workerId = `${os.hostname()}-${process.pid}`; private readonly startedAt = now();
  constructor(private readonly repositories: Repositories, private readonly provider: TranscriptionProvider, private readonly onProgress?: (jobId:string,progress:import("./types.js").TranscriptionProgress)=>void) {}
  recoverStale(): number { const active = this.repositories.sqlite.prepare("SELECT id,progress_updated_at AS progressUpdatedAt FROM transcription_jobs WHERE status IN ('preparing','processing','finalizing')").all() as any[]; let recovered=0; const timestamp=now(); this.repositories.sqlite.transaction(()=>{ for (const job of active) if (isStale(job.progressUpdatedAt, Date.now(), getConfig().staleAfterSeconds)) { this.repositories.sqlite.prepare("UPDATE transcription_jobs SET status='queued',progress_phase='queued',progress_type='indeterminate',progress_percent=0,external_job_id=NULL,worker_id=NULL,error_code=NULL,error_message=NULL,queued_at=?,updated_at=?,progress_updated_at=? WHERE id=?").run(timestamp,timestamp,timestamp,job.id); recovered++; } })(); if (recovered) logger.warn({ recovered }, "Recovered stale transcription jobs"); return recovered; }
  claimNext(jobId?: string): Record<string, any> | undefined { const timestamp=now(); return this.repositories.sqlite.transaction(()=>{ const job=(jobId ? this.repositories.sqlite.prepare("SELECT * FROM transcription_jobs WHERE id=? AND status='queued'").get(jobId) : this.repositories.sqlite.prepare("SELECT * FROM transcription_jobs WHERE status='queued' ORDER BY queued_at LIMIT 1").get()) as any; if (!job) return undefined; const result=this.repositories.sqlite.prepare("UPDATE transcription_jobs SET status='preparing',progress_phase='preparing_audio',worker_id=?,started_at=COALESCE(started_at,?),heartbeat_at=?,progress_updated_at=?,updated_at=? WHERE id=? AND status='queued'").run(this.workerId,timestamp,timestamp,timestamp,timestamp,job.id); return result.changes ? this.repositories.sqlite.prepare("SELECT * FROM transcription_jobs WHERE id=?").get(job.id) as Record<string,any> : undefined; })(); }
  async processOne(jobId?: string): Promise<boolean> { const job=this.claimNext(jobId); if (!job) return false; const message=this.repositories.sqlite.prepare("SELECT * FROM voice_messages WHERE id=?").get(job.voice_message_id) as any; const service=new TranscriptionService(this.repositories); try { logger.info({ jobId: job.id, voiceMessageId: job.voice_message_id }, "Transcription job claimed"); const { externalJobId }=await this.provider.startJob({ voiceMessageId:job.voice_message_id,filePath:message.local_file_path,mimeType:message.mime_type,requestedLanguage:job.requested_language,model:job.model,correlationId:job.id }); this.repositories.sqlite.prepare("UPDATE transcription_jobs SET external_job_id=?,updated_at=? WHERE id=? AND status!='cancelled'").run(externalJobId,now(),job.id); const result=await this.provider.streamProgress(externalJobId,(progress)=>{service.persistProgress(job.id,progress);this.onProgress?.(job.id,progress)}); service.complete(job.id,result); logger.info({ jobId: job.id, durationMilliseconds: result.durationMilliseconds, realTimeFactor: result.realTimeFactor }, "Transcription completed"); } catch(error) { service.fail(job.id,error); logger.error({ jobId:job.id,error:error instanceof Error?error.message:"Unknown error" },"Transcription failed"); } return true; }
  private heartbeat(): void { try { this.repositories.sqlite.prepare("INSERT INTO worker_heartbeats(worker_id,worker_type,started_at,heartbeat_at) VALUES(?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at").run(this.workerId,"transcription",this.startedAt,now()); } catch(error) { logger.warn({workerId:this.workerId,error:error instanceof Error?error.message:"Heartbeat failed"},"Transcription runner heartbeat failed"); } }
  async run(options: { once?: boolean; pollMs?: number } = {}): Promise<void> { this.recoverStale(); this.stopping=false;this.heartbeat();const heartbeat=setInterval(()=>this.heartbeat(),heartbeatIntervalMs);try{while(!this.stopping){const processed=await this.processOne();if(options.once)return;if(!processed)await delay(options.pollMs??1000);}}finally{clearInterval(heartbeat)} }
  stop(): void { this.stopping=true; }
}
