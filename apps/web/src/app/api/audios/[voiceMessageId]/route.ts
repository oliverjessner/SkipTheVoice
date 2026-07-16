import { z } from "zod";
import { application, apiError, assertCsrf, webContext } from "@/lib/api";

const updateAudio = z.object({
  name: z.string().max(120).nullable(),
}).strict();

type RouteContext = { params: Promise<{ voiceMessageId: string }> };

export async function GET(_: Request, { params }: RouteContext) {
  try {
    return Response.json(application().repositories.getVoiceMessage(await webContext(), (await params).voiceMessageId));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await assertCsrf(request);
    const { name } = updateAudio.parse(await request.json());
    return Response.json(application().setVoiceMessageName(await webContext(), (await params).voiceMessageId, name));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    await assertCsrf(request);
    return Response.json(await application().deleteVoiceMessage(await webContext(), (await params).voiceMessageId));
  } catch (error) {
    return apiError(error);
  }
}
