import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { sanitizeMarketRunForBrowser } from "@/lib/market/browser";
import { getMarketErrorMessage, getMarketRouteStatus } from "@/lib/market/contracts";
import {
  getMarketRunSnapshotForUser,
} from "@/lib/market/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const snapshot = await getMarketRunSnapshotForUser(user.id, id);

    if (!snapshot) {
      return NextResponse.json({ error: "Market run not found." }, { status: 404 });
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
    const message = getMarketErrorMessage(error, "Unable to load market run");
    const status = getMarketRouteStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
