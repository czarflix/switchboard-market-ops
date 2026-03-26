import { MarketWorkspace } from "@/components/app/market/market-workspace";
import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { sanitizeMarketRunForBrowser } from "@/lib/market/browser";
import {
  getCurrentMarketRunSnapshotForUser,
  getMarketRunSnapshotForRecording,
  getMarketRunSnapshotForUser,
} from "@/lib/market/repository";

type MarketPageProps = {
  searchParams?: Promise<{
    researchSessionId?: string | string[];
    marketRunId?: string | string[];
    recordingMode?: string | string[];
  }>;
};

const MARKET_RECORDING_REPLAY_DURATION_MS = 21_000;

export default async function MarketPage({ searchParams }: MarketPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const researchSessionId = Array.isArray(resolvedSearchParams?.researchSessionId)
    ? resolvedSearchParams.researchSessionId[0]
    : resolvedSearchParams?.researchSessionId;
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
          rawDurationMs: MARKET_RECORDING_REPLAY_DURATION_MS,
        }
      : null;

  if (recordingReplay && marketRunId) {
    const recordingRun = await getMarketRunSnapshotForRecording(marketRunId);
    const browserRun = recordingRun ? sanitizeMarketRunForBrowser(recordingRun) : null;

    return (
      <MarketWorkspace
        key={browserRun?.run.id ?? marketRunId ?? researchSessionId ?? "market"}
        researchSessionId={researchSessionId ?? browserRun?.run.researchSessionId ?? null}
        requestedRunMissing={Boolean(marketRunId) && !recordingRun}
        notificationEmail={null}
        initialRun={browserRun}
        recordingReplay={recordingReplay}
      />
    );
  }

  const user = await requireAuthenticatedUser("/market");
  const initialRun = marketRunId
    ? await getMarketRunSnapshotForUser(user.id, marketRunId)
    : researchSessionId
      ? await getCurrentMarketRunSnapshotForUser(user.id, researchSessionId)
      : null;
  const browserRun = initialRun ? sanitizeMarketRunForBrowser(initialRun) : null;

  return (
    <MarketWorkspace
      key={browserRun?.run.id ?? marketRunId ?? researchSessionId ?? "market"}
      researchSessionId={researchSessionId ?? null}
      requestedRunMissing={Boolean(marketRunId) && !initialRun}
      notificationEmail={user.email ?? null}
      initialRun={browserRun
        ? {
            ...browserRun,
            run: {
              ...browserRun.run,
              guide: signGuideEnvelope(browserRun.run.guide),
            },
          }
        : null}
      recordingReplay={recordingReplay}
    />
  );
}
