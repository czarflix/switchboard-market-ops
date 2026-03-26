import { ResearchWorkspace } from "@/components/app/research/research-workspace";
import type { ResearchSessionSnapshot } from "@/components/app/research/types";
import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { flattenResearchSessionSnapshot } from "@/lib/research/presenter";
import {
  getLatestResearchSnapshotForUser,
  getResearchSnapshotForRecording,
  getResearchSnapshotForUser,
} from "@/lib/research/repository";

export const dynamic = "force-dynamic";
const RESEARCH_RECORDING_REPLAY_DURATION_MS = 17_000;

async function getInitialSession(
  userId: string,
  sessionId?: string,
): Promise<ResearchSessionSnapshot | null> {
  if (!sessionId) {
    return null;
  }

  const snapshot = await getResearchSnapshotForUser(userId, sessionId);

  return flattenResearchSessionSnapshot(snapshot);
}

async function getResumeCandidate(userId: string) {
  const snapshot = await getLatestResearchSnapshotForUser(userId);
  return flattenResearchSessionSnapshot(snapshot);
}

type ResearchPageProps = {
  searchParams?: Promise<{
    researchSessionId?: string | string[];
    recordingMode?: string | string[];
  }>;
};

export default async function ResearchPage({ searchParams }: ResearchPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const researchSessionId = Array.isArray(resolvedSearchParams?.researchSessionId)
    ? resolvedSearchParams.researchSessionId[0]
    : resolvedSearchParams?.researchSessionId;
  const recordingMode = Array.isArray(resolvedSearchParams?.recordingMode)
    ? resolvedSearchParams.recordingMode[0]
    : resolvedSearchParams?.recordingMode;
  const recordingReplay =
    recordingMode === "replay" && process.env.NODE_ENV !== "production"
      ? {
          enabled: true,
          rawDurationMs: RESEARCH_RECORDING_REPLAY_DURATION_MS,
        }
      : null;

  if (recordingReplay && researchSessionId) {
    const recordingSession = await getResearchSnapshotForRecording(researchSessionId);

    if (recordingSession) {
      return (
        <ResearchWorkspace
          initialSession={flattenResearchSessionSnapshot(recordingSession)}
          resumeCandidate={null}
          recordingReplay={recordingReplay}
        />
      );
    }
  }

  const user = await requireAuthenticatedUser("/research");
  const initialSession = await getInitialSession(user.id, researchSessionId);
  const resumeCandidate = researchSessionId ? null : await getResumeCandidate(user.id);

  return (
    <ResearchWorkspace
      initialSession={initialSession}
      resumeCandidate={resumeCandidate}
      recordingReplay={recordingReplay}
    />
  );
}
