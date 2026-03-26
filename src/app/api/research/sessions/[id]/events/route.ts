import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { appendResearchConversationEventForUser } from "@/lib/research/repository";
import { researchConversationEventSchema } from "@/lib/research/schemas";

function maybeConversationId(payload: Record<string, unknown>) {
  if (typeof payload.conversationId === "string") {
    return payload.conversationId;
  }

  if (typeof payload.conversation_id === "string") {
    return payload.conversation_id;
  }

  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? (payload.metadata as Record<string, unknown>)
      : null;

  if (typeof metadata?.conversationId === "string") {
    return metadata.conversationId;
  }

  if (typeof metadata?.conversation_id === "string") {
    return metadata.conversation_id;
  }

  return undefined;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const payload =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const event = researchConversationEventSchema.safeParse(payload);
    const normalizedEvent = event.success
      ? event.data
      : researchConversationEventSchema.parse({
          kind: typeof payload.kind === "string" ? payload.kind : "sdk-status",
          sessionId: id,
          payload:
            payload.payload && typeof payload.payload === "object"
              ? (payload.payload as Record<string, unknown>)
              : payload,
          seq: typeof payload.seq === "number" ? payload.seq : undefined,
          createdAt:
            typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString(),
          conversationId: maybeConversationId(payload),
        });

    const persistedEvent = await appendResearchConversationEventForUser(user.id, normalizedEvent);
    return NextResponse.json({ ok: true, event: persistedEvent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to persist research event";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
