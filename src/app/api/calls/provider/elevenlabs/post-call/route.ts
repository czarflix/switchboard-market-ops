import { timingSafeEqual } from "node:crypto";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";
import { ingestElevenLabsPostCallWebhook } from "@/lib/market/repository";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
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

export async function POST(request: Request) {
  try {
    const resolvedPayload = await resolveWebhookPayload(request);
    const payload = asRecord(resolvedPayload) ?? {};
    const result = await ingestElevenLabsPostCallWebhook(payload);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to persist webhook payload";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
