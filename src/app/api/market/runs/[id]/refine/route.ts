import { after, NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { sanitizeMarketRunForBrowser } from "@/lib/market/browser";
import {
  getMarketErrorMessage,
  getMarketRouteStatus,
  normalizeStructuredMarketRefinement,
} from "@/lib/market/contracts";
import {
  createOrReuseMarketRunForUser,
  getMarketRunSnapshotForUser,
  kickoffMarketRun,
} from "@/lib/market/repository";
import {
  marketRefinementAlreadyUsedErrorMessage,
} from "@/lib/market/schemas";
import { parseMarketRefinementFromNaturalLanguage } from "@/lib/market/openai-client";
import { getResearchSnapshotForUser } from "@/lib/research/repository";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const currentRun = await getMarketRunSnapshotForUser(user.id, id);
    const researchSessionId = currentRun?.run.researchSessionId ?? id;
    const researchSnapshot = currentRun
      ? null
      : await getResearchSnapshotForUser(user.id, researchSessionId);
    const brief = currentRun?.run.briefSnapshot ?? researchSnapshot?.brief;

    if (!brief) {
      return NextResponse.json({ error: "Research session not found." }, { status: 404 });
    }

    const rawNotes =
      body && typeof body === "object" && "refinement" in body
        ? typeof (body as { refinement?: { notes?: unknown } }).refinement?.notes === "string"
          ? (body as { refinement: { notes: string } }).refinement.notes
          : typeof (body as { notes?: unknown }).notes === "string"
            ? (body as { notes: string }).notes
            : ""
        : typeof (body as { notes?: unknown })?.notes === "string"
          ? (body as { notes: string }).notes
          : typeof body === "string"
            ? body
            : "";

    const structuredRefinementSource =
      body && typeof body === "object" && "refinement" in body
        ? (body as { refinement?: unknown }).refinement
        : body;
    const structuredRefinement = normalizeStructuredMarketRefinement(structuredRefinementSource, rawNotes);
    const refinement = structuredRefinement ?? await parseMarketRefinementFromNaturalLanguage({
      brief,
      notes: rawNotes,
    });
    const snapshot = await createOrReuseMarketRunForUser(user.id, {
      researchSessionId,
      sourceRunId: currentRun?.run.id,
      refinement,
    });

    if (snapshot.run.status === "queued") {
      after(async () => {
        await kickoffMarketRun(snapshot.run.id);
      });
    }

    return NextResponse.json({
      run: sanitizeMarketRunForBrowser(snapshot),
    });
  } catch (error) {
    const message = getMarketErrorMessage(error, "Unable to refine market run");
    const status = getMarketRouteStatus(message, {
      notFoundMessages: ["Research session not found."],
      conflictMessages: [marketRefinementAlreadyUsedErrorMessage],
    });
    return NextResponse.json({ error: message }, { status });
  }
}
