import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { sanitizeWinnerArtifactForBrowser } from "@/lib/market/browser";
import { buildWinnerGuide } from "@/lib/market/guides";
import {
  getWinnerDecisionSnapshotForUser,
  saveWinnerSelectionForUser,
} from "@/lib/market/repository";
import { confirmWinnerSelectionSchema } from "@/lib/market/schemas";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const body = await request.json().catch(() => ({}));
    const parsed = confirmWinnerSelectionSchema.parse(body);
    const artifact = await saveWinnerSelectionForUser(user.id, parsed);
    const decision = await getWinnerDecisionSnapshotForUser(user.id, {
      callCampaignId: parsed.callCampaignId,
    });

    const winner = sanitizeWinnerArtifactForBrowser(artifact);
    const selectedName =
      winner.selectedCandidateId && decision
        ? decision.ranking.find((entry) => entry.candidateId === winner.selectedCandidateId)?.displayName ?? null
        : null;
    const recommendedCandidateId = decision?.selectedCandidateId ?? decision?.recommendedCandidateId ?? null;
    const recommendedName =
      recommendedCandidateId && decision
        ? decision.ranking.find((entry) => entry.candidateId === recommendedCandidateId)?.displayName ?? null
        : null;
    return NextResponse.json({
      winner,
      guide: signGuideEnvelope(
        buildWinnerGuide({
          winner: { ...winner, selectedName },
          decision: decision ? { campaignId: decision.campaignId, status: decision.status, recommendedName } : null,
        }),
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to confirm winner";
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Call campaign not found."
          ? 404
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
