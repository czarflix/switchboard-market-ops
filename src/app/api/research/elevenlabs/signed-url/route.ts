import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { getServerEnv } from "@/lib/env";
import { buildResearchDynamicVariables } from "@/lib/research/elevenlabs-client";
import { createResearchHandoffToken } from "@/lib/research/handoff-token";
import { getResearchSnapshotForUser } from "@/lib/research/repository";
import {
  assertResearchSessionIsMutable,
  getResearchSessionMutationErrorStatus,
  researchSessionMutationLockedErrorMessage,
  researchSignedUrlRequestSchema,
} from "@/lib/research/schemas";

function normalizeDynamicVariables(
  value: Record<string, unknown>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        return [[key, entry]];
      }

      if (Array.isArray(entry)) {
        const compact = entry
          .filter(
            (item): item is string | number | boolean =>
              typeof item === "string" || typeof item === "number" || typeof item === "boolean",
          )
          .join(", ");

        return compact ? [[key, compact]] : [];
      }

      if (entry && typeof entry === "object") {
        return [[key, JSON.stringify(entry)]];
      }

      return [];
    }),
  );
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const body = await request.json().catch(() => ({}));
    const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const parsed = researchSignedUrlRequestSchema.parse({
      ...source,
      sessionId:
        typeof source.researchSessionId === "string"
          ? source.researchSessionId
          : source.sessionId,
      userId: user.id,
    });
    const snapshot = await getResearchSnapshotForUser(user.id, parsed.sessionId);

    if (!snapshot) {
      return NextResponse.json({ error: "Research session not found." }, { status: 404 });
    }

    assertResearchSessionIsMutable(snapshot.session);

    const env = getServerEnv();
    const apiKey = env.elevenLabsApiKey;
    const agentId = env.elevenLabsResearchAgentId;

    if (!apiKey || !agentId) {
      throw new Error("ElevenLabs research agent is not configured.");
    }

    if (!env.researchIntakeSessionSecret) {
      throw new Error("Research intake secret is not configured.");
    }

    const client = new ElevenLabsClient({ apiKey });
    const resumeContext =
      snapshot.session.resume_context && typeof snapshot.session.resume_context === "object"
        ? (snapshot.session.resume_context as Record<string, unknown>)
        : {};

    const dynamicVariables = {
      ...normalizeDynamicVariables(parsed.dynamicVariables),
      ...buildResearchDynamicVariables({
        sessionId: snapshot.session.id,
        userId: user.id,
        priorSummary:
          parsed.priorSummary ||
          (typeof resumeContext.priorSummary === "string" ? resumeContext.priorSummary : undefined) ||
          snapshot.brief.summary,
        missingFields:
          parsed.missingFields.length > 0 ? parsed.missingFields : snapshot.brief.missingFields,
        supportedCategories:
          parsed.supportedCategories.length > 0
            ? parsed.supportedCategories
            : ["banquet", "coworking", "clinic"],
      }),
      secret__handoff_token: createResearchHandoffToken(snapshot.session.id, env.researchIntakeSessionSecret),
    };
    const signedUrl = await client.conversationalAi.conversations.getSignedUrl({
      agentId,
      includeConversationId: true,
      branchId: env.elevenLabsResearchAgentBranchId || undefined,
    });

    return NextResponse.json({
      signedUrl: signedUrl.signedUrl,
      dynamicVariables,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create signed URL";
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Research session not found."
          ? 404
          : message === researchSessionMutationLockedErrorMessage
            ? getResearchSessionMutationErrorStatus(message)
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
