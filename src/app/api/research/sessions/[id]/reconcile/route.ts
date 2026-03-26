import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { flattenResearchSessionSnapshot } from "@/lib/research/presenter";
import { reconcileResearchSessionForUser } from "@/lib/research/repository";

function statusForError(message: string) {
  if (message === "Unauthorized") {
    return 401;
  }

  if (message === "Research session not found.") {
    return 404;
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
    const body = (await request.json().catch(() => null)) as
      | {
          mode?: unknown;
        }
      | null;
    const mode = body?.mode === "transcript_sync" ? "transcript_sync" : "default";
    const result = await reconcileResearchSessionForUser(user.id, id, {
      mode,
    });

    if (!result?.snapshot) {
      return NextResponse.json({ error: "Research session not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      session: flattenResearchSessionSnapshot(result.snapshot),
      recovered: result.recovered,
      reason: result.reason,
      source: result.source,
      missingFields: result.missingFields,
      lastToolFailureKind: result.lastToolFailureKind,
      lastToolFailureReason: result.lastToolFailureReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile research session";
    const status = statusForError(message);
    return NextResponse.json({ error: message }, { status });
  }
}
