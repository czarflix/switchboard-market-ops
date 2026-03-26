import type { CallCampaignSnapshot, MarketRunSnapshot } from "./presenter.ts";
import type { GuideEnvelope, WinnerArtifactRecord } from "./schemas.ts";

function coerceRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asSafeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildGuideEnvelope(input: Omit<GuideEnvelope, "personaId" | "audioState" | "speechToken">): GuideEnvelope {
  return {
    personaId: "switchboard",
    audioState: "muted",
    speechToken: "",
    ...input,
  };
}

function buildSpeechKey(parts: Array<string | number | null | undefined>) {
  return parts.filter(Boolean).join(":");
}

function hasContactPath(candidate: MarketRunSnapshot["candidates"][number]) {
  return Boolean(candidate.phone || candidate.whatsappNumber || candidate.websiteUrl);
}

function compareCandidatesForNarration(
  left: MarketRunSnapshot["candidates"][number],
  right: MarketRunSnapshot["candidates"][number],
) {
  if (left.rank !== right.rank) {
    return left.rank - right.rank;
  }

  if (left.score !== right.score) {
    return right.score - left.score;
  }

  return left.displayName.localeCompare(right.displayName);
}

function getNarratableMarketCandidates(candidates: MarketRunSnapshot["candidates"]) {
  return [...candidates]
    .filter((candidate) => candidate.eligibility !== "ineligible" && hasContactPath(candidate))
    .sort(compareCandidatesForNarration);
}

function formatNameList(names: string[]) {
  if (names.length === 0) {
    return "";
  }

  if (names.length === 1) {
    return names[0]!;
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function getMarketGuide(
  run: MarketRunSnapshot["run"],
  candidates: MarketRunSnapshot["candidates"],
): GuideEnvelope {
  const narratableCandidates = getNarratableMarketCandidates(candidates);
  const firstLead = narratableCandidates[0] ?? null;
  const topShortlist = narratableCandidates.slice(0, 2);
  const topNames = topShortlist.map((candidate) => candidate.displayName);
  const topNameIds = topShortlist.map((candidate) => candidate.id);

  switch (run.status) {
    case "discovering":
    case "scraping":
    case "fallback_discovering":
    case "scoring":
      if (firstLead) {
        return buildGuideEnvelope({
          stage: "market",
          mode: "narrated",
          headline: `${firstLead.displayName} is on the board`,
          body: `${firstLead.displayName} is the first reviewable lead with a usable contact path. Firecrawl is still widening and verifying the shortlist.`,
          accent: "Powered by Firecrawl",
          speakableText: `Switchboard update. Firecrawl just surfaced ${firstLead.displayName} as the first viable lead.`,
          speechKey: buildSpeechKey(["market", run.id, "lead", firstLead.id]),
          nextActionLabel: "Stand by",
          nextActionHref: "",
          blockingState: true,
        });
      }

      return buildGuideEnvelope({
        stage: "market",
        mode: "narrated",
        headline: "Firecrawl scan in progress",
        body: "Switchboard is widening the market board and pressure-testing which establishments deserve the shortlist.",
        accent: "Powered by Firecrawl",
        speakableText:
          "Switchboard update. Firecrawl is scanning the current web market and building the first shortlist.",
        speechKey: buildSpeechKey(["market", run.id, "scan", "start"]),
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
      });
    case "ready":
      return buildGuideEnvelope({
        stage: "market",
        mode: "narrated",
        headline: topNames.length > 0
          ? `${formatNameList(topNames)} ${topNames.length === 1 ? "is" : "are"} ready to call`
          : "Shortlist ready to call",
        body: "Firecrawl surfaced enough fit establishments. Confirm up to four and Switchboard will move them into outreach.",
        accent: "Powered by Firecrawl",
        speakableText:
          topNames.length > 0
            ? `Switchboard update. Firecrawl has finished the shortlist. ${formatNameList(topNames)} ${topNames.length === 1 ? "is" : "are"} ready for calls.`
            : "Switchboard update. Firecrawl has finished the shortlist. Confirm up to four establishments and I will move them into outreach.",
        speechKey: buildSpeechKey(["market", run.id, "ready", ...topNameIds]),
        nextActionLabel: "Move to calls",
        nextActionHref: run.id ? `/calls?marketRunId=${encodeURIComponent(run.id)}` : "",
        blockingState: false,
      });
    case "needs_input":
      return buildGuideEnvelope({
        stage: "market",
        mode: "narrated",
        headline: topNames.length > 0 ? `${formatNameList(topNames)} survived the scan` : "Tighten the brief or proceed",
        body: "Firecrawl found a thin board. You can use your single refinement, or move forward with the strongest surviving options.",
        accent: "One refinement remaining",
        speakableText:
          topNames.length > 0
            ? `Switchboard update. Firecrawl finished with a thinner board than we want. ${formatNameList(topNames)} ${topNames.length === 1 ? "is" : "are"} the strongest surviving options. You can refine once, or proceed now.`
            : "Switchboard update. Firecrawl found a thinner board than we want. You can refine once, or proceed with the strongest surviving options.",
        speechKey: buildSpeechKey(["market", run.id, "needs_input", ...topNameIds]),
        nextActionLabel: "Refine or proceed",
        nextActionHref: "",
        blockingState: false,
      });
    case "failed":
      return buildGuideEnvelope({
        stage: "market",
        mode: "narrated",
        headline: "Market scan needs intervention",
        body: "Firecrawl surfaced an actionable error. Review the failure, then rerun the scan cleanly.",
        accent: "Firecrawl blocked",
        speakableText:
          "Switchboard update. Firecrawl hit an actionable error. Review it, then rerun the scan cleanly.",
        speechKey: buildSpeechKey(["market", run.id, run.status]),
        nextActionLabel: "Retry scan",
        nextActionHref: "",
        blockingState: true,
      });
    default:
      return buildGuideEnvelope({
        stage: "market",
        mode: "narrated",
        headline: "Queueing the market handoff",
        body: "Switchboard is packaging the intake brief and handing the scan over to Firecrawl.",
        accent: "Powered by Firecrawl",
        speakableText:
          "Switchboard update. I am packaging the intake brief and handing the market scan over to Firecrawl.",
        speechKey: buildSpeechKey(["market", run.id, "scan", "queued"]),
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
      });
  }
}

type BrowserCallProjection = {
  id: string;
  candidateId: string;
  orderIndex: number;
  businessName: string;
  targetDurationMs: number;
  actualDurationMs?: number | null;
  sourceLanguage: string;
  elapsedMs: number;
  status: string;
  turns: Array<{
    id: string;
    seq: number;
    speaker: "buyer" | "seller" | "system";
    sourceText: string;
    englishText: string;
    offsetMs: number;
    createdAt: string;
  }>;
  visibleTurns: Array<{
    id: string;
    seq: number;
    speaker: "buyer" | "seller" | "system";
    sourceText: string;
    englishText: string;
    offsetMs: number;
    createdAt: string;
  }>;
  result: string | null;
  providerState: Record<string, unknown> | null;
  outcome: {
    result: string;
    availabilityStatus: string;
    quotedPrice?: number;
    discountOffered?: number;
    depositRequired: boolean;
    holdPossible: boolean;
    websiteUrl: string;
    whatsappNumber: string;
    contactName: string;
    contactChannel: string;
    confidence: number;
    summarySourceText: string;
    summaryEnglishText: string;
    structuredDetails: Record<string, unknown>;
  } | null;
  playback: {
    laneStartOffsetMs: number;
    ringStartMs: number;
    pickupAtMs?: number | null;
    negotiationStartMs?: number | null;
    callEndMs: number;
    summaryRevealMs: number;
    endedEarly: boolean;
    resolutionKind: string;
  } | null;
  summaryVisible: boolean;
  summaryRevealAtMs: number | null;
};

type BrowserResolutionFeedEntry = {
  callId: string;
  orderIndex: number;
  businessName: string;
  status: string;
  summarySourceText: string;
  summaryEnglishText: string;
  revealedAtMs: number;
};

const terminalPlaybackStatuses = new Set(["completed", "no_answer", "failed"]);
const activePlaybackStatuses = new Set(["ringing", "connected", "negotiating", "wrap_up"]);
const playbackStatusRank = new Map([
  ["preparing", 0],
  ["queued", 1],
  ["ringing", 2],
  ["connected", 3],
  ["negotiating", 4],
  ["wrap_up", 5],
  ["completed", 6],
  ["no_answer", 6],
  ["failed", 6],
]);

function compareResolutionFeedEntries(
  left: BrowserResolutionFeedEntry,
  right: BrowserResolutionFeedEntry,
) {
  if (left.revealedAtMs !== right.revealedAtMs) {
    return left.revealedAtMs - right.revealedAtMs;
  }

  if (left.orderIndex !== right.orderIndex) {
    return left.orderIndex - right.orderIndex;
  }

  return left.callId.localeCompare(right.callId);
}

function summarizeProjectedCalls(
  projection: BrowserSafeCallProjection,
  calls: BrowserCallProjection[],
): Pick<BrowserSafeCallProjection, "calls" | "resolutionFeed" | "campaign"> {
  const resolutionFeed = calls
    .filter((call) => call.summaryVisible && call.summaryRevealAtMs !== null)
    .map((call) => ({
      callId: call.id,
      orderIndex: call.orderIndex,
      businessName: call.businessName,
      status: call.status,
      summarySourceText: call.outcome?.summarySourceText ?? "",
      summaryEnglishText: call.outcome?.summaryEnglishText ?? "",
      revealedAtMs: call.summaryRevealAtMs ?? 0,
    }))
    .sort(compareResolutionFeedEntries);
  const completedCalls = resolutionFeed.length;
  const activeCalls = calls.filter((call) => activePlaybackStatuses.has(call.status)).length;
  const failedCalls = calls.filter((call) => call.status === "failed").length;

  return {
    calls,
    resolutionFeed,
    campaign: {
      ...projection.campaign,
      canOpenWinner:
        projection.campaign.status === "completed" &&
        calls.length > 0 &&
        calls.every((call) => call.summaryVisible || call.status === "failed"),
      summary: {
        totalCalls: calls.length,
        completedCalls,
        activeCalls,
        failedCalls,
      },
    },
  };
}

export type BrowserSafeCallProjection = {
  campaign: {
    id: string;
    marketRunId: string;
    researchSessionId: string;
    status: string;
    displayLanguage: "source" | "english";
    sourceLanguage: string;
    selectionFingerprint: string;
    playbackStartedAt?: string | null;
    playbackEndsAt?: string | null;
    updatedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
    canOpenWinner: boolean;
    guide: GuideEnvelope;
    summary: {
      totalCalls: number;
      completedCalls: number;
      activeCalls: number;
      failedCalls: number;
    };
  };
  calls: BrowserCallProjection[];
  winner: {
    id: string;
    selectedCandidateId: string;
    reportSourceText: string;
    reportEnglishText: string;
    ranking: Array<{
      candidateId: string;
      rank: number;
      score: number;
      reason: string;
    }>;
  } | null;
  notifications: Array<{
    id: string;
    channel: string;
    status: string;
    createdAt?: string | null;
    sentAt?: string | null;
  }>;
  resolutionFeed: BrowserResolutionFeedEntry[];
};

function deriveLegacyVisibleCallStatus(
  call: BrowserCallProjection,
  elapsedMs: number,
  campaignStatus: string,
) {
  if (terminalPlaybackStatuses.has(call.status)) {
    return call.status;
  }

  if (call.status === "dialing") {
    const phaseSchedule = coerceRecord(call.providerState?.phaseSchedule);
    const ringingUntilMs =
      asSafeNumber(phaseSchedule.ringingUntilMs) ??
      Math.min(Math.max(call.targetDurationMs * 0.18, 3_500), 7_500);
    const negotiatingAtMs =
      asSafeNumber(phaseSchedule.negotiatingAtMs) ??
      Math.min(Math.max(call.targetDurationMs * 0.62, 12_000), 24_000);

    if (elapsedMs < ringingUntilMs) {
      return "ringing";
    }

    if (elapsedMs < negotiatingAtMs) {
      return "connected";
    }

    return "negotiating";
  }

  if (call.status === "connected" || call.status === "negotiating") {
    return call.status;
  }

  if (!call.playback) {
    return campaignStatus === "preparing" ? "preparing" : "queued";
  }

  return call.status;
}

function derivePlaybackStatus(call: BrowserCallProjection, campaignElapsedMs: number, campaignStatus: string) {
  if (!call.playback) {
    return deriveLegacyVisibleCallStatus(call, campaignElapsedMs, campaignStatus);
  }

  if (campaignStatus === "cancelled" || campaignStatus === "superseded") {
    const resolvedResult = call.result ?? call.outcome?.result ?? null;
    if (resolvedResult === "no_answer") {
      return "no_answer";
    }
    if (resolvedResult) {
      return "completed";
    }
    return "failed";
  }

  const playback = call.playback;
  const wrapUpAtMs = Math.max(
    playback.negotiationStartMs ?? playback.pickupAtMs ?? playback.ringStartMs,
    playback.callEndMs - 2500,
  );

  if (campaignStatus === "preparing") {
    return "preparing";
  }

  if (campaignElapsedMs < playback.laneStartOffsetMs) {
    return "queued";
  }

  if (campaignElapsedMs < (playback.pickupAtMs ?? playback.callEndMs)) {
    return "ringing";
  }

  if (campaignElapsedMs >= playback.callEndMs && campaignElapsedMs < playback.summaryRevealMs) {
    return "wrap_up";
  }

  if (campaignElapsedMs >= playback.callEndMs) {
    if (playback.resolutionKind === "no_answer") {
      return "no_answer";
    }

    if (playback.resolutionKind === "failed") {
      return "failed";
    }

    return "completed";
  }

  if (campaignElapsedMs < (playback.negotiationStartMs ?? playback.callEndMs)) {
    return "connected";
  }

  if (campaignElapsedMs < wrapUpAtMs) {
    return "negotiating";
  }

  return "wrap_up";
}

function getCampaignElapsedMs(playbackStartedAt: string | null | undefined, nowMs: number) {
  return playbackStartedAt
    ? Math.max(nowMs - new Date(playbackStartedAt).getTime(), 0)
    : 0;
}

function hydrateCallsProjection(
  projection: BrowserSafeCallProjection,
  nowMs = Date.now(),
): BrowserSafeCallProjection {
  const campaignElapsedMs = getCampaignElapsedMs(projection.campaign.playbackStartedAt, nowMs);
  const calls = projection.calls.map((call) => {
    const providerInitiatedAt =
      typeof call.providerState?.initiatedAt === "string"
        ? call.providerState.initiatedAt
        : projection.campaign.playbackStartedAt;
    const callElapsedMs = getCampaignElapsedMs(providerInitiatedAt, nowMs);

    if (!call.playback) {
      const visibleTurns = call.turns.filter((turn) => turn.offsetMs <= callElapsedMs);
      const summaryVisible = ["completed", "no_answer", "failed"].includes(call.status);
      return {
        ...call,
        status: deriveLegacyVisibleCallStatus(call, callElapsedMs, projection.campaign.status),
        elapsedMs: Math.min(callElapsedMs, call.targetDurationMs),
        visibleTurns,
        summaryVisible,
        summaryRevealAtMs:
          summaryVisible
            ? call.turns.at(-1)?.offsetMs ?? call.actualDurationMs ?? call.targetDurationMs
            : null,
        outcome: summaryVisible ? call.outcome : null,
        result: summaryVisible ? call.result : null,
      };
    }

    const laneElapsedMs = Math.max(campaignElapsedMs - call.playback.laneStartOffsetMs, 0);
    const summaryVisible = campaignElapsedMs >= call.playback.summaryRevealMs;

    return {
      ...call,
      status: derivePlaybackStatus(call, campaignElapsedMs, projection.campaign.status),
      elapsedMs: Math.min(laneElapsedMs, call.targetDurationMs),
      visibleTurns: call.turns.filter((turn) => turn.offsetMs <= laneElapsedMs),
      summaryVisible,
      summaryRevealAtMs: call.playback.summaryRevealMs,
      outcome: summaryVisible ? call.outcome : null,
      result: summaryVisible ? call.result : null,
    };
  });
  return {
    ...projection,
    ...summarizeProjectedCalls(projection, calls),
  };
}

function mergeMonotonicStatus(currentStatus: string, nextStatus: string) {
  const currentRank = playbackStatusRank.get(currentStatus) ?? -1;
  const nextRank = playbackStatusRank.get(nextStatus) ?? -1;

  if (
    terminalPlaybackStatuses.has(currentStatus) &&
    terminalPlaybackStatuses.has(nextStatus) &&
    currentStatus !== "failed" &&
    nextStatus === "failed"
  ) {
    return currentStatus;
  }

  if (
    terminalPlaybackStatuses.has(currentStatus) &&
    terminalPlaybackStatuses.has(nextStatus) &&
    currentStatus === "failed" &&
    nextStatus !== "failed"
  ) {
    return nextStatus;
  }

  if (nextRank > currentRank) {
    return nextStatus;
  }

  if (currentRank > nextRank) {
    return currentStatus;
  }

  if (terminalPlaybackStatuses.has(nextStatus)) {
    return nextStatus;
  }

  return currentStatus;
}

function mergeVisibleTurns(
  current: BrowserCallProjection["visibleTurns"],
  next: BrowserCallProjection["visibleTurns"],
) {
  const byId = new Map<string, BrowserCallProjection["visibleTurns"][number]>();

  for (const turn of current) {
    byId.set(turn.id, turn);
  }

  for (const turn of next) {
    byId.set(turn.id, turn);
  }

  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

export function mergeCallCampaignProjection(
  current: BrowserSafeCallProjection,
  incoming: BrowserSafeCallProjection,
  nowMs = Date.now(),
): BrowserSafeCallProjection {
  const refreshedIncoming = refreshCallCampaignProjection(incoming, nowMs);

  if (current.campaign.id !== refreshedIncoming.campaign.id) {
    return refreshedIncoming;
  }

  const currentById = new Map(current.calls.map((call) => [call.id, call]));
  const mergedCalls = refreshedIncoming.calls.map((nextCall) => {
    const currentCall = currentById.get(nextCall.id);

    if (!currentCall) {
      return nextCall;
    }

    const summaryVisible = currentCall.summaryVisible || nextCall.summaryVisible;

    return {
      ...nextCall,
      status: mergeMonotonicStatus(currentCall.status, nextCall.status),
      elapsedMs: Math.max(currentCall.elapsedMs, nextCall.elapsedMs),
      visibleTurns: mergeVisibleTurns(currentCall.visibleTurns, nextCall.visibleTurns),
      summaryVisible,
      summaryRevealAtMs: nextCall.summaryRevealAtMs ?? currentCall.summaryRevealAtMs,
      outcome: summaryVisible ? nextCall.outcome ?? currentCall.outcome : null,
      result: summaryVisible ? nextCall.result ?? currentCall.result : null,
    };
  });
  const mergedCampaignStatus =
    current.campaign.status === "completed" && refreshedIncoming.campaign.status === "active"
      ? current.campaign.status
      : current.campaign.status === "failed" &&
          !["failed", "cancelled", "superseded"].includes(refreshedIncoming.campaign.status)
        ? current.campaign.status
        : refreshedIncoming.campaign.status;
  const merged = {
    ...refreshedIncoming,
    campaign: {
      ...refreshedIncoming.campaign,
      status: mergedCampaignStatus,
    },
  };
  const summarized = summarizeProjectedCalls(merged, mergedCalls);
  const desiredGuide = getCallsGuide({
    ...merged,
    ...summarized,
    campaign: {
      ...summarized.campaign,
      status: mergedCampaignStatus,
    },
  });
  const signedGuide =
    refreshedIncoming.campaign.guide.speechKey === desiredGuide.speechKey &&
    refreshedIncoming.campaign.guide.speechToken
      ? refreshedIncoming.campaign.guide
      : current.campaign.guide.speechKey === desiredGuide.speechKey &&
          current.campaign.guide.speechToken
        ? current.campaign.guide
        : desiredGuide;

  return {
    ...merged,
    ...summarized,
    campaign: {
      ...summarized.campaign,
      guide: signedGuide,
    },
  };
}

function scoreCallLead(call: BrowserCallProjection) {
  const result = call.outcome?.result ?? call.result ?? null;
  const confidence = call.outcome?.confidence ?? 0;
  const quotedPrice = call.outcome?.quotedPrice ?? Number.POSITIVE_INFINITY;
  const resultWeight =
    result === "accepted"
      ? 4
      : result === "countered"
        ? 3
        : result === "refused"
          ? 2
          : result === "no_answer"
            ? 1
            : 0;

  return resultWeight * 1000 + Math.round(confidence * 100) - Math.min(quotedPrice, 1_000_000) / 10;
}

function pickCurrentLead(calls: BrowserCallProjection[]) {
  const reviewable = calls.filter((call) => {
    const result = call.outcome?.result ?? call.result ?? null;
    return result === "accepted" || result === "countered" || result === "refused";
  });

  if (reviewable.length === 0) {
    return null;
  }

  return [...reviewable].sort((left, right) => {
    const scoreDelta = scoreCallLead(right) - scoreCallLead(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return compareProjectedCallsForNarration(left, right);
  })[0] ?? null;
}

function compareProjectedCallsForNarration(left: BrowserCallProjection, right: BrowserCallProjection) {
  if (left.orderIndex !== right.orderIndex) {
    return left.orderIndex - right.orderIndex;
  }

  return left.id.localeCompare(right.id);
}

function collectRecentResolutionBatch(resolutionFeed: BrowserSafeCallProjection["resolutionFeed"], windowMs = 1_500) {
  const latest = resolutionFeed.at(-1) ?? null;
  if (!latest) {
    return [];
  }

  const batch = [latest];

  for (let index = resolutionFeed.length - 2; index >= 0; index -= 1) {
    const entry = resolutionFeed[index];
    if (!entry || latest.revealedAtMs - entry.revealedAtMs > windowMs) {
      break;
    }
    batch.unshift(entry);
  }

  return batch;
}

function formatResolutionNarration(entry: BrowserSafeCallProjection["resolutionFeed"][number]) {
  const summary = entry.summaryEnglishText.trim() || entry.summarySourceText.trim();
  const businessName = entry.businessName.trim();

  if (!summary) {
    return `${businessName} resolved.`;
  }

  if (summary.toLowerCase().startsWith(businessName.toLowerCase())) {
    return summary;
  }

  return `${businessName}: ${summary}`;
}

function getCallsGuide(projection: BrowserSafeCallProjection): GuideEnvelope {
  const { campaign, calls, resolutionFeed } = projection;
  const campaignId = campaign.id;
  const status = campaign.status;
  const orderedCalls = [...calls].sort(compareProjectedCallsForNarration);
  const activeNames = orderedCalls.slice(0, 4).map((call) => call.businessName);

  switch (status) {
    case "queued":
      return buildGuideEnvelope({
        stage: "calls",
        mode: "narrated",
        headline: "Switchboard is staging outreach",
        body: "The selected establishments are locked. ElevenLabs narration will track each lane as soon as playback begins.",
        accent: "Narrated with ElevenLabs",
        speakableText:
          "Switchboard update. The outreach board is being staged. ElevenLabs narration will track each lane as soon as playback begins.",
        speechKey: buildSpeechKey(["calls", campaignId, status]),
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
      });
    case "preparing":
      return buildGuideEnvelope({
        stage: "calls",
        mode: "narrated",
        headline: "Seller lanes are being prepared",
        body: "Switchboard is turning your selected establishments into believable outreach lanes before playback starts.",
        accent: "Narrated with ElevenLabs",
        speakableText:
          "Switchboard update. Seller lanes are being prepared before playback starts.",
        speechKey: buildSpeechKey(["calls", campaignId, status]),
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
      });
    case "active":
      if (resolutionFeed.length > 0) {
        const batchedEntries = collectRecentResolutionBatch(resolutionFeed);
        const latest = batchedEntries.at(-1)!;
        const headline =
          batchedEntries.length === 1
            ? `${latest.businessName} just resolved`
            : `${formatNameList(batchedEntries.map((entry) => entry.businessName))} just resolved`;
        const speakableText = batchedEntries.map(formatResolutionNarration).join(" ");

        return buildGuideEnvelope({
          stage: "calls",
          mode: "narrated",
          headline,
          body: "Switchboard is turning resolved lanes into short recaps as the outreach board settles.",
          accent: "Narrated with ElevenLabs",
          speakableText: `Switchboard update. ${speakableText}`,
          speechKey: buildSpeechKey([
            "calls",
            campaignId,
            status,
            "recap",
            resolutionFeed.length,
            ...batchedEntries.map((entry) => entry.callId),
          ]),
          nextActionLabel: "Watch the board",
          nextActionHref: "",
          blockingState: true,
        });
      }

      return buildGuideEnvelope({
        stage: "calls",
        mode: "narrated",
        headline: "Parallel outreach is live",
        body: "Switchboard is tracking each ringing, connection, negotiation, and wrap-up beat while ElevenLabs narrates the board.",
        accent: "Guided by Switchboard",
        speakableText:
          activeNames.length > 0
            ? `Switchboard update. Parallel outreach is live. I am tracking ${formatNameList(activeNames)}.`
            : "Switchboard update. Parallel outreach is live. I am tracking the shortlisted outreach lanes now.",
        speechKey: buildSpeechKey(["calls", campaignId, status, "intro", ...orderedCalls.map((call) => call.id)]),
        nextActionLabel: "Watch the board",
        nextActionHref: "",
        blockingState: true,
      });
    case "completed":
      {
        const currentLead = pickCurrentLead(calls);
        const leadName = currentLead?.businessName?.trim();
        return buildGuideEnvelope({
          stage: "winner",
          mode: "narrated",
          headline: leadName ? `${leadName} leads the board` : "Outreach complete",
          body: "Every lane has resolved. Review the strongest option and confirm the final winner when you’re ready.",
          accent: "ElevenLabs recap ready",
          speakableText: leadName
            ? `Switchboard update. Outreach is complete. ${leadName} is the strongest lead right now. Review the winner board and confirm the final recommendation.`
            : "Switchboard update. Outreach is complete. Review the strongest option and confirm the final winner when you are ready.",
          speechKey: buildSpeechKey(["calls", campaignId, status, currentLead?.id ?? "none"]),
          nextActionLabel: "Open winner",
          nextActionHref: "",
          blockingState: false,
        });
      }
    case "failed":
    case "cancelled":
    case "superseded":
      return buildGuideEnvelope({
        stage: "calls",
        mode: "narrated",
        headline: "Outreach needs intervention",
        body: "The campaign failed before playback completed. Retry the board to generate a fresh outreach attempt.",
        accent: "Action required",
        speakableText:
          "Switchboard update. Outreach failed before playback completed. Retry the board to generate a fresh attempt.",
        speechKey: buildSpeechKey(["calls", campaignId, status]),
        nextActionLabel: "Retry outreach",
        nextActionHref: "",
        blockingState: true,
      });
    default:
      return buildGuideEnvelope({
        stage: "calls",
        mode: "narrated",
        headline: "Waiting to start outreach",
        body: "The outreach board is waiting for a valid call campaign.",
        accent: "Stand by",
        speakableText:
          "Switchboard update. The outreach board is waiting for a valid call campaign.",
        speechKey: buildSpeechKey(["calls", campaignId, status]),
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
      });
  }
}

export function sanitizeMarketRunForBrowser(snapshot: MarketRunSnapshot) {
  return {
    run: {
      id: snapshot.run.id,
      researchSessionId: snapshot.run.researchSessionId,
      status: snapshot.run.status,
      currentStage: snapshot.run.currentStage,
      summary: snapshot.run.summary,
      error: snapshot.run.error,
      updatedAt: snapshot.run.updatedAt,
      completedAt: snapshot.run.completedAt,
      briefSnapshot: snapshot.run.briefSnapshot,
      refinements: snapshot.run.refinements,
      canRefine: snapshot.run.refinements.length === 0 && snapshot.run.status !== "superseded",
      refinementLimitReached: snapshot.run.refinements.length > 0,
      guide: getMarketGuide(snapshot.run, snapshot.candidates),
    },
    candidates: snapshot.candidates.map((candidate) => ({
      id: candidate.id,
      rank: candidate.rank,
      displayName: candidate.displayName,
      canonicalUrl: candidate.canonicalUrl,
      websiteUrl: candidate.websiteUrl,
      phone: candidate.phone,
      whatsappNumber: candidate.whatsappNumber,
      locality: candidate.locality,
      city: candidate.city,
      address: candidate.address,
      summary: candidate.summary,
      eligibility: candidate.eligibility,
      selectedForCalls: candidate.selectedForCalls,
      score: candidate.score,
      evidenceCount: candidate.evidenceCount,
      scoreBreakdown: candidate.scoreBreakdown,
      fitNotes: candidate.fitNotes,
      sourceLanguage: candidate.sourceLanguage,
      evidence: (snapshot.evidence[candidate.id] ?? []).map((entry) => ({
        sourceUrl: entry.sourceUrl,
        sourceDomain: entry.sourceDomain,
        sourceKind: entry.sourceKind,
        isFirstParty: entry.isFirstParty,
        confidence: entry.confidence,
        excerpt: entry.excerpt,
      })),
    })),
    notifications: snapshot.notifications.map((entry) => ({
      id: entry.id,
      channel: entry.channel,
      status: entry.status,
      createdAt: entry.createdAt,
      sentAt: entry.sentAt,
    })),
  };
}

export function projectCallCampaignForBrowser(snapshot: CallCampaignSnapshot, nowMs = Date.now()) {
  const rawCalls: BrowserCallProjection[] = snapshot.calls.map((call) => {
    const payload = coerceRecord(call.payload);
    const playbackRecord = coerceRecord(payload.playback);

    return {
      id: call.id,
      candidateId: call.candidateId,
      orderIndex: call.orderIndex,
      businessName: call.plan.businessName,
      targetDurationMs: call.targetDurationMs,
      actualDurationMs: call.actualDurationMs ?? null,
      sourceLanguage: call.scenario.targetLanguage,
      elapsedMs: 0,
      status: call.status,
      turns: call.turns,
      visibleTurns: [],
      result: call.outcome?.result ?? call.result ?? null,
      providerState: call.providerState ?? null,
      outcome: call.outcome,
      playback:
        Object.keys(playbackRecord).length > 0
          ? {
              laneStartOffsetMs: asSafeNumber(playbackRecord.laneStartOffsetMs) ?? 0,
              ringStartMs: asSafeNumber(playbackRecord.ringStartMs) ?? 0,
              pickupAtMs: asSafeNumber(playbackRecord.pickupAtMs) ?? null,
              negotiationStartMs: asSafeNumber(playbackRecord.negotiationStartMs) ?? null,
              callEndMs: asSafeNumber(playbackRecord.callEndMs) ?? call.targetDurationMs,
              summaryRevealMs:
                asSafeNumber(playbackRecord.summaryRevealMs) ?? call.targetDurationMs,
              endedEarly: Boolean(playbackRecord.endedEarly),
              resolutionKind:
                typeof playbackRecord.resolutionKind === "string"
                  ? playbackRecord.resolutionKind
                  : call.outcome?.result ?? "failed",
            }
          : null,
      summaryVisible: false,
      summaryRevealAtMs: null,
    };
  });
  const base = {
    campaign: {
      id: snapshot.campaign.id,
      marketRunId: snapshot.campaign.marketRunId,
      researchSessionId: snapshot.campaign.researchSessionId,
      status: snapshot.campaign.status,
      displayLanguage: snapshot.campaign.displayLanguage,
      sourceLanguage: snapshot.campaign.sourceLanguage,
      selectionFingerprint: snapshot.campaign.selectionFingerprint,
      playbackStartedAt: snapshot.campaign.playbackStartedAt,
      playbackEndsAt: snapshot.campaign.playbackEndsAt,
      updatedAt: snapshot.campaign.updatedAt,
      completedAt: snapshot.campaign.completedAt,
      error: snapshot.campaign.error,
      canOpenWinner: false,
      guide: buildGuideEnvelope({
        stage: "calls",
        mode: "narrated",
        headline: "Waiting to start outreach",
        body: "The outreach board is waiting for a valid call campaign.",
        accent: "Stand by",
        speakableText:
          "Switchboard update. The outreach board is waiting for a valid call campaign.",
        speechKey: buildSpeechKey(["calls", snapshot.campaign.id, snapshot.campaign.status, "boot"]),
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
      }),
      summary: {
        totalCalls: rawCalls.length,
        completedCalls: 0,
        activeCalls: 0,
        failedCalls: 0,
      },
    },
    calls: rawCalls,
    winner:
      snapshot.winner && snapshot.campaign.status === "completed"
        ? {
            id: snapshot.winner.id,
            selectedCandidateId: snapshot.winner.selectedCandidateId,
            reportSourceText: snapshot.winner.reportSourceText,
            reportEnglishText: snapshot.winner.reportEnglishText,
            ranking: snapshot.winner.ranking,
          }
        : null,
    notifications: snapshot.notifications.map((entry) => ({
      id: entry.id,
      channel: entry.channel,
      status: entry.status,
      createdAt: entry.createdAt,
      sentAt: entry.sentAt,
    })),
    resolutionFeed: [] as BrowserResolutionFeedEntry[],
  };

  const hydrated = hydrateCallsProjection(base, nowMs);
  return {
    ...hydrated,
    campaign: {
      ...hydrated.campaign,
      guide: getCallsGuide(hydrated),
    },
  };
}

export function refreshCallCampaignProjection(
  projection: BrowserSafeCallProjection,
  nowMs = Date.now(),
): BrowserSafeCallProjection {
  return hydrateCallsProjection(projection, nowMs);
}

export function sanitizeWinnerArtifactForBrowser(artifact: WinnerArtifactRecord) {
  return {
    id: artifact.id,
    selectedCandidateId: artifact.selected_candidate_id,
    reportSourceText: artifact.report_source_text ?? "",
    reportEnglishText: artifact.report_english_text ?? "",
    ranking: Array.isArray(artifact.ranking_json)
      ? artifact.ranking_json.map((entry) => ({
          candidateId: typeof entry.candidateId === "string" ? entry.candidateId : "",
          rank: typeof entry.rank === "number" ? entry.rank : 1,
          score: typeof entry.score === "number" ? entry.score : 0,
          reason: typeof entry.reason === "string" ? entry.reason : "",
        }))
      : [],
  };
}

export type BrowserSafeMarketRun = ReturnType<typeof sanitizeMarketRunForBrowser>;
export type BrowserSafeWinnerArtifact = ReturnType<typeof sanitizeWinnerArtifactForBrowser>;
