import type { GuideEnvelope } from "./schemas";

type MarketFallbackGuideInput = {
  researchSessionId: string | null;
  requestedRunMissing: boolean;
};

type CallsFallbackGuideInput = {
  marketRunId: string | null;
};

type WinnerGuideInput = {
  winner: {
    id: string;
    selectedName?: string | null;
  } | null;
  decision: {
    campaignId: string;
    status?: string | null;
    recommendedName?: string | null;
  } | null;
};

export function buildMarketFallbackGuide(input: MarketFallbackGuideInput): GuideEnvelope {
  return {
    personaId: "switchboard",
    stage: "market",
    mode: "narrated",
    headline: input.requestedRunMissing ? "Market history not found" : "Switchboard is staging Firecrawl",
    body: input.requestedRunMissing
      ? "That market attempt is no longer available. Start a fresh Firecrawl scan from the active brief."
      : "Switchboard is packaging the confirmed intake and handing the market sweep over to Firecrawl.",
    accent: input.requestedRunMissing ? "Action required" : "Powered by Firecrawl",
    speakableText: input.requestedRunMissing
      ? "Switchboard update. That market attempt is no longer available. Start a fresh Firecrawl scan."
      : "Switchboard update. I am packaging the confirmed intake and handing the market sweep over to Firecrawl.",
    speechKey: input.requestedRunMissing
      ? "market:missing"
      : `market:pending:${input.researchSessionId ?? "none"}`,
    speechToken: "",
    nextActionLabel: input.requestedRunMissing ? "Start fresh scan" : "Stand by",
    nextActionHref: "",
    blockingState: !input.requestedRunMissing,
    audioState: "muted",
  };
}

export function buildCallsFallbackGuide(input: CallsFallbackGuideInput): GuideEnvelope {
  return {
    personaId: "switchboard",
    stage: "calls",
    mode: "narrated",
    headline: input.marketRunId ? "Switchboard is staging outreach" : "Select a market run to continue",
    body: input.marketRunId
      ? "The selected establishments are locked. ElevenLabs narration will track each lane as soon as playback begins."
      : "The outreach board is waiting for a valid market handoff before it can stage the lanes.",
    accent: input.marketRunId ? "Narrated with ElevenLabs" : "Stand by",
    speakableText: input.marketRunId
      ? "Switchboard update. The outreach board is being staged. ElevenLabs narration will track each lane as soon as playback begins."
      : "Switchboard update. The outreach board is waiting for a valid market handoff.",
    speechKey: input.marketRunId ? `calls:pending:${input.marketRunId}` : "calls:idle",
    speechToken: "",
    nextActionLabel: "Stand by",
    nextActionHref: "",
    blockingState: true,
    audioState: "muted",
  };
}

export function buildWinnerGuide(input: WinnerGuideInput): GuideEnvelope {
  if (input.winner) {
    const selectedName = input.winner.selectedName?.trim();
    return {
      personaId: "switchboard",
      stage: "winner",
      mode: "narrated",
      headline: selectedName ? `${selectedName} is locked in` : "Final recommendation locked",
      body: selectedName
        ? `${selectedName} is locked as the final recommendation. Export the report and move the handoff forward.`
        : "Switchboard ranked the board from Firecrawl evidence and narrated outreach. Export the winner and move the handoff forward.",
      accent: "Researched with Firecrawl · voiced by ElevenLabs",
      speakableText: selectedName
        ? `Switchboard update. ${selectedName} is locked as the final recommendation. Export the report and move the handoff forward.`
        : "Switchboard update. The final recommendation is locked. Export the winner and move the handoff forward.",
      speechKey: `winner:${input.winner.id}:confirmed`,
      speechToken: "",
      nextActionLabel: "Finalize handoff",
      nextActionHref: "",
      blockingState: false,
      audioState: "muted",
    };
  }

  if (input.decision) {
    if (input.decision.status && input.decision.status !== "completed") {
      return {
        personaId: "switchboard",
        stage: "winner",
        mode: "narrated",
        headline: "Outreach is still settling",
        body: "Switchboard will name the strongest option once every outreach lane has fully resolved.",
        accent: "Winner pending",
        speakableText:
          "Switchboard update. Outreach is still settling. I will name the strongest option once every lane has resolved.",
        speechKey: `winner:${input.decision.campaignId}:waiting`,
        speechToken: "",
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
        audioState: "muted",
      };
    }
    const recommendedName = input.decision.recommendedName?.trim();
    return {
      personaId: "switchboard",
      stage: "winner",
      mode: "narrated",
      headline: recommendedName ? `${recommendedName} is the strongest option` : "Confirm the strongest option",
      body: recommendedName
        ? `${recommendedName} is leading on Firecrawl evidence and the outreach board, but the final winner still needs your confirmation.`
        : "Firecrawl evidence and the narrated outreach board agree on a lead, but the final winner still needs your confirmation.",
      accent: "Review required",
      speakableText: recommendedName
        ? `Switchboard update. The strongest option is ${recommendedName}. Review the board and confirm the final winner.`
        : "Switchboard update. The strongest option is ready. Review the board and confirm the final winner.",
      speechKey: `winner:${input.decision.campaignId}:pending`,
      speechToken: "",
      nextActionLabel: "Confirm winner",
      nextActionHref: "",
      blockingState: false,
      audioState: "muted",
    };
  }

  return {
    personaId: "switchboard",
    stage: "winner",
    mode: "narrated",
    headline: "Waiting for outreach to finish",
    body: "Switchboard will unlock the final decision once the narrated outreach board finishes resolving every lane.",
    accent: "Stand by",
    speakableText:
      "Switchboard update. The final decision will unlock once the outreach board finishes resolving every lane.",
    speechKey: "winner:idle",
    speechToken: "",
    nextActionLabel: "Stand by",
    nextActionHref: "",
    blockingState: true,
    audioState: "muted",
  };
}
