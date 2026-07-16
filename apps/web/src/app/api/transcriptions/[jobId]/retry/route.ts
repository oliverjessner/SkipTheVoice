import { application, apiError, assertCsrf, assertTranscriptionServices, webContext } from "@/lib/api";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await assertCsrf(request);
    await assertTranscriptionServices();
    return Response.json(application().retryTranscription(await webContext(), (await params).jobId), { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
