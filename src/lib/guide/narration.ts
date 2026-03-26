import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env";
import type { GuideEnvelope } from "@/lib/market/schemas";

const narrationCache = new Map<string, { buffer: ArrayBuffer; storedAt: number }>();
const NARRATION_CACHE_MAX_ENTRIES = 64;
const NARRATION_CACHE_TTL_MS = 1000 * 60 * 60;

function getNarrationSecret() {
  const env = getServerEnv();
  const secret =
    env.researchIntakeSessionSecret ??
    env.supabaseServiceRoleKey ??
    env.elevenLabsWebhookSecret ??
    env.elevenLabsApiKey;

  if (!secret) {
    throw new Error("Guide narration secret is not configured.");
  }

  return secret;
}

function signNarrationPayload(speechKey: string, text: string) {
  return createHmac("sha256", getNarrationSecret())
    .update(`${speechKey}:${text}`)
    .digest("base64url");
}

export function signGuideEnvelope<T extends GuideEnvelope>(guide: T): T {
  if (!guide.speakableText.trim() || guide.stage === "research") {
    return { ...guide, speechToken: "" };
  }

  return {
    ...guide,
    speechToken: signNarrationPayload(guide.speechKey, guide.speakableText),
  };
}

export function verifyGuideSpeechToken(input: {
  speechKey: string;
  text: string;
  speechToken: string;
}) {
  if (!input.speechKey.trim() || !input.text.trim() || !input.speechToken.trim()) {
    return false;
  }

  const expected = signNarrationPayload(input.speechKey, input.text);
  const actual = input.speechToken;

  return (
    expected.length === actual.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  );
}

function cacheKey(speechKey: string, speechToken: string) {
  return `${speechKey}:${speechToken}`;
}

export function getCachedGuideNarration(speechKey: string, speechToken: string) {
  const cached = narrationCache.get(cacheKey(speechKey, speechToken));

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.storedAt > NARRATION_CACHE_TTL_MS) {
    narrationCache.delete(cacheKey(speechKey, speechToken));
    return null;
  }

  return cached.buffer;
}

export function setCachedGuideNarration(
  speechKey: string,
  speechToken: string,
  buffer: ArrayBuffer,
) {
  narrationCache.set(cacheKey(speechKey, speechToken), {
    buffer,
    storedAt: Date.now(),
  });

  if (narrationCache.size <= NARRATION_CACHE_MAX_ENTRIES) {
    return;
  }

  const oldestKey = narrationCache.keys().next().value;
  if (typeof oldestKey === "string") {
    narrationCache.delete(oldestKey);
  }
}
