import { existsSync } from "node:fs";
import { getConfig, getDatabase, transcriptionRunnerHealth } from "@skipthevoice/core";
import { application, apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const app = application();
    const database = getDatabase().sqlite.prepare("SELECT 1 ok").get();
    const whisperWorker = await app.whisper.healthCheck();
    const queued = (getDatabase().sqlite.prepare("SELECT COUNT(*) count FROM transcription_jobs WHERE status='queued'").get() as { count: number }).count;
    return Response.json({
      healthy: true,
      database: Boolean(database),
      dataDirectory: existsSync(getConfig().dataDirectory),
      nodeRunner: { ...transcriptionRunnerHealth(app.repositories), queued },
      whisperWorker,
    });
  } catch (error) {
    return apiError(error);
  }
}
