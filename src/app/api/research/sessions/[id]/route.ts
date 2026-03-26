import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { flattenResearchSessionSnapshot } from "@/lib/research/presenter";
import { getResearchSnapshotForUser, saveResearchBriefEditsForUser } from "@/lib/research/repository";
import {
  getResearchSessionMutationErrorStatus,
  researchSessionMutationLockedErrorMessage,
  updateResearchBriefSchema,
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const snapshot = await getResearchSnapshotForUser(user.id, id);

    if (!snapshot) {
      return NextResponse.json({ error: "Research session not found." }, { status: 404 });
    }

    return NextResponse.json({ session: flattenResearchSessionSnapshot(snapshot) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load research session";
    const status = statusForError(message);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = updateResearchBriefSchema.parse({
      sessionId: id,
      brief:
        body && typeof body === "object" && "brief" in body
          ? (body as { brief: unknown }).brief
          : body,
    });
    const snapshot = await saveResearchBriefEditsForUser(
      user.id,
      parsed.sessionId,
      parsed.brief,
    );

    if (!snapshot) {
      return NextResponse.json({ error: "Research session not found." }, { status: 404 });
    }

    return NextResponse.json({ session: flattenResearchSessionSnapshot(snapshot) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update research session";
    const status = statusForError(message);
    return NextResponse.json({ error: message }, { status });
  }
}
