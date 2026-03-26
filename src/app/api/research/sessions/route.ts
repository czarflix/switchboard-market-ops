import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { flattenResearchSessionSnapshot } from "@/lib/research/presenter";
import {
  getOrCreateActiveResearchSessionForUser,
  startNewResearchSessionForUser,
} from "@/lib/research/repository";
import { createResearchSessionRequestSchema } from "@/lib/research/schemas";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const parsed = createResearchSessionRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    const snapshot = parsed.fresh
      ? await startNewResearchSessionForUser(user.id, parsed.inputMode)
      : await getOrCreateActiveResearchSessionForUser(user.id, parsed.inputMode);

    return NextResponse.json({
      session: flattenResearchSessionSnapshot(snapshot),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create research session";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
