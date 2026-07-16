import { z } from "zod";
import { application, apiError, assertCsrf, assertTranscriptionServices, webContext } from "@/lib/api";

const body = z.object({
  voiceMessageId: z.string().min(1),
  language: z.string().min(2).max(12).optional(),
  model: z.string().min(1).max(80).optional(),
});

export async function POST(request: Request) {
  try {
    await assertCsrf(request);
    const value = body.parse(await request.json());
    const app = application();
    await assertTranscriptionServices();
    const options = { ...(value.language ? { language: value.language } : {}), ...(value.model ? { model: value.model } : {}) };
    return Response.json(app.startTranscription(await webContext(), value.voiceMessageId, options), { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
