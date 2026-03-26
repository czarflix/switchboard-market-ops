import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import {
  buildCallsFallbackGuide,
  buildMarketFallbackGuide,
  buildWinnerGuide,
} from "@/lib/market/guides";
import { guideEnvelopeSchema } from "@/lib/market/schemas";

export const dynamic = "force-dynamic";

function normalizeGuideForSigning(guide: ReturnType<typeof guideEnvelopeSchema.parse>) {
  return {
    ...guide,
    speechToken: "",
  };
}

function getCanonicalGuideForSigning(guide: ReturnType<typeof guideEnvelopeSchema.parse>) {
  if (guide.stage === "market") {
    if (guide.speechKey === "market:missing") {
      return buildMarketFallbackGuide({ researchSessionId: null, requestedRunMissing: true });
    }

    const marketPendingMatch = guide.speechKey.match(/^market:pending:(.+)$/);
    if (marketPendingMatch) {
      return buildMarketFallbackGuide({
        researchSessionId: marketPendingMatch[1] === "none" ? null : marketPendingMatch[1],
        requestedRunMissing: false,
      });
    }
  }

  if (guide.stage === "calls") {
    if (guide.speechKey === "calls:idle") {
      return buildCallsFallbackGuide({ marketRunId: null });
    }

    const callsPendingMatch = guide.speechKey.match(/^calls:pending:(.+)$/);
    if (callsPendingMatch) {
      return buildCallsFallbackGuide({ marketRunId: callsPendingMatch[1] });
    }
  }

  if (guide.stage === "winner") {
    if (guide.speechKey === "winner:idle") {
      return buildWinnerGuide({ winner: null, decision: null });
    }

    const winnerPendingMatch = guide.speechKey.match(/^winner:([0-9a-f-]+):pending$/i);
    if (winnerPendingMatch) {
      return buildWinnerGuide({ winner: null, decision: { campaignId: winnerPendingMatch[1] } });
    }

    const winnerConfirmedMatch = guide.speechKey.match(/^winner:([0-9a-f-]+):confirmed$/i);
    if (winnerConfirmedMatch) {
      return buildWinnerGuide({ winner: { id: winnerConfirmedMatch[1] }, decision: null });
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    await getAuthenticatedUserOrThrow();
    const body = await request.json().catch(() => ({}));
    const guide = guideEnvelopeSchema.parse({
      ...body,
      speechToken: "",
    });
    const canonicalGuide = getCanonicalGuideForSigning(guide);

    if (
      !canonicalGuide ||
      JSON.stringify(normalizeGuideForSigning(guide)) !==
        JSON.stringify(normalizeGuideForSigning(canonicalGuide))
    ) {
      throw new Error("Guide signing is only available for Switchboard fallback updates.");
    }

    return NextResponse.json({
      guide: signGuideEnvelope(guide),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign Switchboard update";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
