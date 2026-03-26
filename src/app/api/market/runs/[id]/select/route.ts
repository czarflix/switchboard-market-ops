import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { sanitizeMarketRunForBrowser } from "@/lib/market/browser";
import { getMarketErrorMessage, getMarketRouteStatus } from "@/lib/market/contracts";
import { saveSelectedCallCandidatesForUser } from "@/lib/market/repository";
import { selectMarketCandidatesSchema } from "@/lib/market/schemas";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = selectMarketCandidatesSchema.parse(
      body && typeof body === "object" && "candidateIds" in body ? body : { candidateIds: [] },
    );
    const snapshot = await saveSelectedCallCandidatesForUser(user.id, id, parsed);

    return NextResponse.json({
      run: sanitizeMarketRunForBrowser(snapshot),
    });
  } catch (error) {
    const message = getMarketErrorMessage(error, "Unable to save selected candidates");
    const status = getMarketRouteStatus(message, {
      notFoundMessages: ["Market run not found."],
    });
    return NextResponse.json({ error: message }, { status });
  }
}
