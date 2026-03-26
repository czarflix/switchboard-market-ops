import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { getServerEnv } from "@/lib/env";
import {
  getCachedGuideNarration,
  setCachedGuideNarration,
  verifyGuideSpeechToken,
} from "@/lib/guide/narration";

export const dynamic = "force-dynamic";

const GUIDE_TTS_MODEL = "eleven_flash_v2";
const GUIDE_TTS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export async function POST(request: Request) {
  try {
    await getAuthenticatedUserOrThrow();
    const body = await request.json().catch(() => ({}));
    const speechKey =
      body && typeof body === "object" && typeof (body as { speechKey?: unknown }).speechKey === "string"
        ? (body as { speechKey: string }).speechKey.trim()
        : "";
    const speechToken =
      body && typeof body === "object" && typeof (body as { speechToken?: unknown }).speechToken === "string"
        ? (body as { speechToken: string }).speechToken.trim()
        : "";
    const text =
      body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
        ? (body as { text: string }).text.trim()
        : "";

    if (!speechKey || !speechToken || !text) {
      return NextResponse.json({ error: "Signed guide narration payload is required." }, { status: 400 });
    }

    if (!verifyGuideSpeechToken({ speechKey, speechToken, text })) {
      return NextResponse.json({ error: "Guide narration signature is invalid." }, { status: 403 });
    }

    const cached = getCachedGuideNarration(speechKey, speechToken);
    if (cached) {
      return new Response(cached.slice(0), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "private, max-age=86400",
        },
      });
    }

    const apiKey = getServerEnv().elevenLabsApiKey;

    if (!apiKey) {
      throw new Error("ElevenLabs API key is not configured.");
    }

    const client = new ElevenLabsClient({ apiKey });
    const audio = await client.textToSpeech.convert(GUIDE_TTS_VOICE_ID, {
      text,
      modelId: GUIDE_TTS_MODEL,
      outputFormat: "mp3_44100_128",
    });
    const buffer = await new Response(audio).arrayBuffer();
    setCachedGuideNarration(speechKey, speechToken, buffer);

    return new Response(buffer.slice(0), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to narrate Switchboard update";
    const status =
      message === "Unauthorized"
        ? 401
        : /signature|payload/i.test(message)
          ? 400
          : /ElevenLabs|synthesize|narrate/i.test(message)
            ? 502
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
