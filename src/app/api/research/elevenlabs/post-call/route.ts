import { timingSafeEqual } from "node:crypto";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";
import { appendTrustedResearchEvent, reconcileResearchSessionForService } from "@/lib/research/repository";
import { postCallWebhookPayloadSchema } from "@/lib/research/schemas";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readBearerToken(header: string | null) {
  if (!header) {
    return null;
  }

  return header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
}

function verifySharedSecret(request: Request) {
  const env = getServerEnv();
  const configuredSecret = env.researchIntakeSessionSecret;
  const requestUrl = new URL(request.url);
  const headerSecret =
    readBearerToken(request.headers.get("authorization")) ??
    request.headers.get("x-research-intake-secret")?.trim() ??
    requestUrl.searchParams.get("secret")?.trim() ??
    null;

  if (!configuredSecret) {
    throw new Error("Research intake secret is not configured.");
  }

  if (!headerSecret) {
    return false;
  }

  const configuredBuffer = Buffer.from(configuredSecret);
  const receivedBuffer = Buffer.from(headerSecret);

  if (configuredBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(configuredBuffer, receivedBuffer);
}

async function resolveWebhookPayload(request: Request) {
  const env = getServerEnv();
  const rawBody = await request.text();

  if (env.elevenLabsWebhookSecret) {
    const signatureHeader =
      request.headers.get("x-elevenlabs-signature") ??
      request.headers.get("elevenlabs-signature") ??
      request.headers.get("signature");
    const client = new ElevenLabsClient({
      apiKey: env.elevenLabsApiKey,
    });

    return client.webhooks.constructEvent(rawBody, signatureHeader ?? "", env.elevenLabsWebhookSecret);
  }

  if (!verifySharedSecret(request)) {
    throw new Error("Unauthorized");
  }

  return rawBody ? JSON.parse(rawBody) : {};
}

function extractResearchSessionId(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);
  const dynamicVariables =
    asRecord(payload.dynamic_variables) ??
    asRecord(asRecord(payload.conversation_initiation_client_data)?.dynamic_variables) ??
    asRecord(metadata?.dynamic_variables);

  return firstString(
    payload.research_session_id,
    payload.researchSessionId,
    metadata?.research_session_id,
    metadata?.researchSessionId,
    dynamicVariables?.research_session_id,
    dynamicVariables?.researchSessionId,
  );
}

function extractConversationId(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);

  return firstString(
    payload.conversation_id,
    payload.conversationId,
    metadata?.conversation_id,
    metadata?.conversationId,
  );
}

export async function POST(request: Request) {
  try {
    const resolvedPayload = await resolveWebhookPayload(request);
    const payload = asRecord(resolvedPayload) ?? {};
    const normalized = postCallWebhookPayloadSchema.parse(payload);
    const sessionId = extractResearchSessionId(payload);

    if (!sessionId) {
      throw new Error("Missing research session id in webhook payload.");
    }

    const metadata = asRecord(payload.metadata);
    const eventId = firstString(
      payload.event_id,
      payload.eventId,
      payload.id,
      metadata?.event_id,
      metadata?.eventId,
    );
    const kind =
      firstString(
        normalized.event_type,
        normalized.eventType,
        payload.type,
      ) ?? "post_call_webhook";

    const persistedEvent = await appendTrustedResearchEvent(
      sessionId,
      kind,
      {
        ...payload,
        conversation_id: extractConversationId(payload),
      },
      eventId,
    );

    if (!persistedEvent) {
      return NextResponse.json(
        { error: "Research session not found." },
        { status: 404 },
      );
    }

    const reconciliation = await reconcileResearchSessionForService(
      sessionId,
      extractConversationId(payload),
    );

    return NextResponse.json({
      ok: true,
      sessionId,
      recovered: reconciliation?.recovered ?? false,
      reason: reconciliation?.reason ?? null,
      source: reconciliation?.source ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to persist webhook payload";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
