import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";

function readAuthSecret(request: Request) {
  const authorization = request.headers.get("authorization");
  const explicit = request.headers.get("x-research-intake-secret");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  return explicit?.trim() ?? authorization?.trim() ?? null;
}

function hasMatchingSecret(request: Request) {
  const configuredSecret = getServerEnv().researchIntakeSessionSecret?.trim();
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

export async function GET(request: Request) {
  try {
    if (!hasMatchingSecret(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const env = getServerEnv();

    return NextResponse.json({
      researchAgentId: env.elevenLabsResearchAgentId,
      researchAgentBranchId: env.elevenLabsResearchAgentBranchId ?? null,
      appBaseUrl: env.appBaseUrl ?? null,
      genericAgentId: env.elevenLabsAgentId ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to read research runtime";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
