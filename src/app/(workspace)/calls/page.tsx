import { CallsWorkspace } from "@/components/app/calls/calls-workspace";
import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { projectCallCampaignForBrowser } from "@/lib/market/browser";
import {
  getCallCampaignSnapshotForRecording,
  getCallCampaignSnapshotForUser,
  getCurrentCallCampaignSnapshotForRecording,
  getCurrentCallCampaignForUser,
} from "@/lib/market/repository";

type CallsPageProps = {
  searchParams?: Promise<{
    callCampaignId?: string | string[];
    marketRunId?: string | string[];
    recordingMode?: string | string[];
  }>;
};

const CALLS_RECORDING_REPLAY_DURATION_MS = 21_000;

export default async function CallsPage({ searchParams }: CallsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const callCampaignId = Array.isArray(resolvedSearchParams?.callCampaignId)
    ? resolvedSearchParams.callCampaignId[0]
    : resolvedSearchParams?.callCampaignId;
  const marketRunId = Array.isArray(resolvedSearchParams?.marketRunId)
    ? resolvedSearchParams.marketRunId[0]
    : resolvedSearchParams?.marketRunId;
  const recordingMode = Array.isArray(resolvedSearchParams?.recordingMode)
    ? resolvedSearchParams.recordingMode[0]
    : resolvedSearchParams?.recordingMode;
  const recordingReplay =
    recordingMode === "replay" && process.env.NODE_ENV !== "production"
      ? {
          enabled: true,
          rawDurationMs: CALLS_RECORDING_REPLAY_DURATION_MS,
        }
      : null;

  if (recordingReplay && (callCampaignId || marketRunId)) {
    const recordingCampaign = callCampaignId
      ? await getCallCampaignSnapshotForRecording(callCampaignId)
      : marketRunId
        ? await getCurrentCallCampaignSnapshotForRecording(marketRunId)
        : null;
    const browserCampaign = recordingCampaign ? projectCallCampaignForBrowser(recordingCampaign) : null;

    return (
      <CallsWorkspace
        key={browserCampaign?.campaign.id ?? callCampaignId ?? marketRunId ?? "calls"}
        marketRunId={marketRunId ?? browserCampaign?.campaign.marketRunId ?? null}
        notificationEmail={null}
        initialCampaign={browserCampaign}
        recordingReplay={recordingReplay}
      />
    );
  }

  const user = await requireAuthenticatedUser("/calls");
  const initialCampaign = callCampaignId
    ? await getCallCampaignSnapshotForUser(user.id, callCampaignId)
    : marketRunId
      ? await getCurrentCallCampaignForUser(user.id, marketRunId).then(async (campaign) =>
          campaign ? getCallCampaignSnapshotForUser(user.id, campaign.id) : null,
        )
      : null;
  const browserCampaign = initialCampaign ? projectCallCampaignForBrowser(initialCampaign) : null;

  return (
    <CallsWorkspace
      key={browserCampaign?.campaign.id ?? callCampaignId ?? marketRunId ?? "calls"}
      marketRunId={marketRunId ?? null}
      notificationEmail={user.email ?? null}
      initialCampaign={browserCampaign
        ? {
            ...browserCampaign,
            campaign: {
              ...browserCampaign.campaign,
              guide: signGuideEnvelope(browserCampaign.campaign.guide),
            },
          }
        : null}
      recordingReplay={recordingReplay}
    />
  );
}
