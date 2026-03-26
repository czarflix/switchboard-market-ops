import { after, NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { sanitizeMarketRunForBrowser } from "@/lib/market/browser";
import { getMarketErrorMessage, getMarketRouteStatus } from "@/lib/market/contracts";
import {
  createOrReuseMarketRunForUser,
  kickoffMarketRun,
} from "@/lib/market/repository";
import {
  createMarketRunRequestSchema,
  marketRefinementAlreadyUsedErrorMessage,
} from "@/lib/market/schemas";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const body = await request.json().catch(() => ({}));
    const parsed = createMarketRunRequestSchema.parse(body);
    const snapshot = await createOrReuseMarketRunForUser(user.id, parsed);

    if (snapshot.run.status === "queued") {
      after(async () => {
        await kickoffMarketRun(snapshot.run.id);
      });
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
    const message = getMarketErrorMessage(error, "Unable to create market run");
    const status = getMarketRouteStatus(message, {
      notFoundMessages: ["Research session not found."],
      conflictMessages: [marketRefinementAlreadyUsedErrorMessage],
    });
    return NextResponse.json({ error: message }, { status });
  }
}
