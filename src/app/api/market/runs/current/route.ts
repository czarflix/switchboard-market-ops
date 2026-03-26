import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { sanitizeMarketRunForBrowser } from "@/lib/market/browser";
import { getMarketErrorMessage, getMarketRouteStatus } from "@/lib/market/contracts";
import { getCurrentMarketRunSnapshotForUser } from "@/lib/market/repository";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const researchSessionId = new URL(request.url).searchParams.get("researchSessionId");

    if (!researchSessionId) {
      return NextResponse.json({ error: "Research session id is required." }, { status: 400 });
    }

    const snapshot = await getCurrentMarketRunSnapshotForUser(user.id, researchSessionId);

    if (!snapshot) {
      return NextResponse.json({ run: null });
    }

    const browserRun = sanitizeMarketRunForBrowser(snapshot);

    return NextResponse.json({
      run: {
        ...browserRun,
        run: {
          ...browserRun.run,
          guide: signGuideEnvelope(browserRun.run.guide),
        },
      },
    });
  } catch (error) {
    const message = getMarketErrorMessage(error, "Unable to load current market run");
    const status = getMarketRouteStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
