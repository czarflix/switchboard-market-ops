import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { sanitizeWinnerArtifactForBrowser } from "@/lib/market/browser";
import { getLatestWinnerArtifactForUser } from "@/lib/market/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const artifact = await getLatestWinnerArtifactForUser(user.id, {
      winnerArtifactId: id,
    });

    if (!artifact) {
      return NextResponse.json({ error: "Winner artifact not found." }, { status: 404 });
    }

    return NextResponse.json({ winner: sanitizeWinnerArtifactForBrowser(artifact) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load winner artifact";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
