import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";
import { flattenResearchSessionSnapshot } from "@/lib/research/presenter";
import { saveResearchBriefFromToolPayload } from "@/lib/research/repository";
import { resolveResearchHandoffSessionId } from "@/lib/research/handoff-token";
import {
  buildResearchHandoffAutofillPayload,
  buildResearchHandoffContinuationGuidance,
  normalizeSaveResearchBriefToolPayload,
} from "@/lib/research/schemas";

function readAuthSecret(request: Request) {
  const authorization = request.headers.get("authorization");
  const explicit = request.headers.get("x-research-intake-secret");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  return explicit?.trim() ?? authorization?.trim() ?? null;
}

function hasMatchingSecret(request: Request) {
  const configuredSecret = getServerEnv().researchIntakeSessionSecret;
  const receivedSecret = readAuthSecret(request);

  if (!configuredSecret) {
    throw new Error("Research intake secret is not configured.");
  }

  if (!receivedSecret) {
    return false;
  }

  const configuredBuffer = Buffer.from(configuredSecret);
  const receivedBuffer = Buffer.from(receivedSecret);

  if (configuredBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(configuredBuffer, receivedBuffer);
}

function readHandoffToken(request: Request) {
  return request.headers.get("x-research-handoff-token")?.trim() ?? null;
}

export async function POST(request: Request) {
  try {
    if (!hasMatchingSecret(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const env = getServerEnv();
    const body = await request.json().catch(() => ({}));
    const handoffToken = readHandoffToken(request);
    const legacySessionId =
      body &&
      typeof body === "object" &&
      typeof (body as { research_session_id?: unknown }).research_session_id === "string"
        ? (body as { research_session_id: string }).research_session_id
        : "";
    const resolvedSessionId = resolveResearchHandoffSessionId({
      handoffToken,
      legacySessionId,
      secret: env.researchIntakeSessionSecret,
    });

    let parsed = normalizeSaveResearchBriefToolPayload(body, {
      sessionId: resolvedSessionId,
      countryCode: "IN",
    });

    if (!parsed?.research_session_id) {
      const continuation = buildResearchHandoffContinuationGuidance(body, {
        sessionId: resolvedSessionId,
        countryCode: "IN",
      });

      if (continuation?.missingFields.length) {
        return NextResponse.json({
          ok: false,
          saved: false,
          retryable: true,
          missingFields: continuation.missingFields,
          nextQuestion:
            continuation.nextField && continuation.nextQuestion
              ? {
                  field: continuation.nextField,
                  prompt: continuation.nextQuestion,
                }
              : null,
        });
      }

      parsed = buildResearchHandoffAutofillPayload(body, {
        sessionId: resolvedSessionId,
        countryCode: "IN",
      });

      if (parsed?.research_session_id) {
        const snapshot = await saveResearchBriefFromToolPayload(parsed);

        return NextResponse.json({
          ok: true,
          session: flattenResearchSessionSnapshot(snapshot),
          brief: snapshot.brief,
          redirectReady: snapshot.brief.readyForMarket,
        });
      }

      throw new Error("Research handoff payload did not match the expected schema.");
    }

    const snapshot = await saveResearchBriefFromToolPayload(parsed);

    return NextResponse.json({
      ok: true,
      session: flattenResearchSessionSnapshot(snapshot),
      brief: snapshot.brief,
      redirectReady: snapshot.brief.readyForMarket,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save research brief";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
