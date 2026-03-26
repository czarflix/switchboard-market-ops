import { after, NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { projectCallCampaignForBrowser } from "@/lib/market/browser";
import {
  createOrReuseCallCampaignForUser,
  kickoffCallCampaign,
} from "@/lib/market/repository";
import { createCallCampaignRequestSchema } from "@/lib/market/schemas";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const body = await request.json().catch(() => ({}));
    const parsed = createCallCampaignRequestSchema.parse(body);
    const snapshot = await createOrReuseCallCampaignForUser(user.id, parsed);

    if (snapshot.campaign.status === "queued") {
      after(async () => {
        await kickoffCallCampaign(snapshot.campaign.id);
      });
    }

    const browserCampaign = projectCallCampaignForBrowser(snapshot);

    return NextResponse.json({
      campaign: {
        ...browserCampaign,
        campaign: {
          ...browserCampaign.campaign,
          guide: signGuideEnvelope(browserCampaign.campaign.guide),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create call campaign";
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Market run not found."
          ? 404
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
