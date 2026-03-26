import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { flattenResearchSessionSnapshot } from "@/lib/research/presenter";
import { confirmResearchSessionForUser, saveResearchBriefEditsForUser } from "@/lib/research/repository";
import {
  getResearchSessionMutationErrorStatus,
  partialResearchBriefSchema,
  researchSessionMutationLockedErrorMessage,
} from "@/lib/research/schemas";

export function statusForError(message: string) {
  if (message === "Unauthorized") {
    return 401;
  }

  if (message === "Research session not found.") {
    return 404;
  }

  if (message === researchSessionMutationLockedErrorMessage) {
    return getResearchSessionMutationErrorStatus(message);
  }

  return 400;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (body?.brief) {
      const brief = partialResearchBriefSchema.parse(body.brief);
      await saveResearchBriefEditsForUser(user.id, id, brief);
    }

    const snapshot = await confirmResearchSessionForUser(user.id, id);

    if (!snapshot) {
      return NextResponse.json({ error: "Research session not found." }, { status: 404 });
    }

    return NextResponse.json({
      session: flattenResearchSessionSnapshot(snapshot),
      redirectUrl: `/market?researchSessionId=${snapshot.session.id}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to confirm research session";
    const status = statusForError(message);
    return NextResponse.json({ error: message }, { status });
  }
}
