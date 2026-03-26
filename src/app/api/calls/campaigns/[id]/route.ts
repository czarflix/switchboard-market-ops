import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { projectCallCampaignForBrowser } from "@/lib/market/browser";
import {
  getCallCampaignSnapshotForUser,
} from "@/lib/market/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const snapshot = await getCallCampaignSnapshotForUser(user.id, id);

    if (!snapshot) {
      return NextResponse.json({ error: "Call campaign not found." }, { status: 404 });
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
    const message = error instanceof Error ? error.message : "Unable to load call campaign";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
