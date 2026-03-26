import { WinnerWorkspace } from "@/components/app/winner/winner-workspace";
import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { buildWinnerGuide } from "@/lib/market/guides";
import {
  getLatestWinnerArtifactForRecording,
  getLatestWinnerArtifactForUser,
  getWinnerDecisionSnapshotForRecording,
  getWinnerDecisionSnapshotForUser,
} from "@/lib/market/repository";

type WinnerPageProps = {
  searchParams?: Promise<{
    winnerArtifactId?: string | string[];
    callCampaignId?: string | string[];
    marketRunId?: string | string[];
    recordingMode?: string | string[];
  }>;
};

const WINNER_RECORDING_REPLAY_DURATION_MS = 17_000;

function buildRecordingWinnerGuide(input: Parameters<typeof buildWinnerGuide>[0]) {
  const guide = buildWinnerGuide(input);

  return {
    ...guide,
    speechKey: `${guide.speechKey}:recording`,
    speechToken: "",
    audioState: "muted" as const,
  };
}

export default async function WinnerPage({ searchParams }: WinnerPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const winnerArtifactId = Array.isArray(resolvedSearchParams?.winnerArtifactId)
    ? resolvedSearchParams.winnerArtifactId[0]
    : resolvedSearchParams?.winnerArtifactId;
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
          rawDurationMs: WINNER_RECORDING_REPLAY_DURATION_MS,
        }
      : null;
  const replayParams = {
    winnerArtifactId: winnerArtifactId ?? undefined,
    callCampaignId: callCampaignId ?? undefined,
    marketRunId: marketRunId ?? undefined,
  };
  const user = recordingReplay ? null : await requireAuthenticatedUser("/winner");
  const winner = recordingReplay
    ? await getLatestWinnerArtifactForRecording(replayParams)
    : user
      ? await getLatestWinnerArtifactForUser(user.id, replayParams)
      : null;
  const decision = recordingReplay
    ? await getWinnerDecisionSnapshotForRecording(replayParams)
    : user
      ? await getWinnerDecisionSnapshotForUser(user.id, replayParams)
      : null;
  const normalizedDecision = decision
    ? {
        ...decision,
        confirmed: decision.confirmed || Boolean(recordingReplay),
        selectedCandidateId: decision.selectedCandidateId ?? decision.recommendedCandidateId ?? null,
      }
    : null;
  const replayWinner =
    recordingReplay && !winner && normalizedDecision?.selectedCandidateId
      ? {
          id: `winner-recording:${normalizedDecision.campaignId}`,
          selectedCandidateId: normalizedDecision.selectedCandidateId,
          reportSourceText: normalizedDecision.reportSourceText,
          reportEnglishText: normalizedDecision.reportEnglishText,
          ranking: normalizedDecision.ranking.map((entry) => ({
            candidateId: entry.candidateId,
            rank: entry.rank,
            score: entry.score,
            reason: entry.reason,
          })),
        }
      : null;
  const normalizedWinner = winner
    ? {
        id: winner.id,
        selectedCandidateId: winner.selected_candidate_id,
        reportSourceText: winner.report_source_text ?? "",
        reportEnglishText: winner.report_english_text ?? "",
        ranking: Array.isArray(winner.ranking_json)
          ? winner.ranking_json.map((entry) => ({
              candidateId: typeof entry.candidateId === "string" ? entry.candidateId : "",
              rank: typeof entry.rank === "number" ? entry.rank : 1,
              score: typeof entry.score === "number" ? entry.score : 0,
              reason: typeof entry.reason === "string" ? entry.reason : "",
            }))
          : [],
      }
    : replayWinner;
  const selectedName =
    normalizedWinner?.selectedCandidateId
      ? normalizedDecision?.ranking.find((entry) => entry.candidateId === normalizedWinner.selectedCandidateId)?.displayName ?? null
      : null;
  const recommendedCandidateId = normalizedDecision?.selectedCandidateId ?? normalizedDecision?.recommendedCandidateId ?? null;
  const recommendedName =
    recommendedCandidateId
      ? normalizedDecision?.ranking.find((entry) => entry.candidateId === recommendedCandidateId)?.displayName ?? null
      : null;
  const initialGuide = recordingReplay
    ? buildRecordingWinnerGuide({
        winner: normalizedWinner ? { ...normalizedWinner, selectedName } : null,
        decision: normalizedDecision ? { ...normalizedDecision, status: normalizedDecision.status, recommendedName } : null,
      })
    : signGuideEnvelope(
        buildWinnerGuide({
          winner: normalizedWinner ? { ...normalizedWinner, selectedName } : null,
          decision: normalizedDecision ? { ...normalizedDecision, status: normalizedDecision.status, recommendedName } : null,
        }),
      );

  return (
    <WinnerWorkspace
      key={[
        normalizedWinner?.id ?? "winner",
        normalizedDecision?.campaignId ?? callCampaignId ?? marketRunId ?? "winner",
        normalizedDecision?.status ?? "unknown",
        normalizedDecision?.selectedCandidateId ?? "none",
        normalizedDecision?.recommendedCandidateId ?? "none",
      ].join(":")}
      winner={normalizedWinner}
      decision={normalizedDecision}
      initialGuide={initialGuide}
      notificationEmail={user?.email ?? null}
      recordingReplay={recordingReplay}
    />
  );
}
