import "server-only";

import { getServerEnv } from "../env.ts";
import {
  alignSimulatedTurnsToPlayback,
  buildCallPlaybackEnvelope,
  buildCallingPlan,
  buildSellerScenario,
  deriveCallResult,
  selectPrimaryConversationLanguage,
} from "./logic.ts";
import {
  callOutcomeSchema,
  callPlanSchema,
  marketRefinementSchema,
  sellerScenarioSchema,
  simulatedCallArtifactSchema,
  type CallOutcome,
  type CallPlan,
  type CallingPolicy,
  type MarketCandidateEvidence,
  type MarketCandidate,
  type MarketRefinement,
  type SellerScenario,
  type SimulatedCallArtifact,
} from "./schemas.ts";
import { type ResearchBrief } from "../research/schemas.ts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function getOpenAiApiKey() {
  const apiKey = getServerEnv().openAiApiKey;

  if (!apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  return apiKey;
}

export function getCallsOpenAiModel() {
  return process.env.OPENAI_CALLS_MODEL || "gpt-5.4";
}

const openAiCallArtifactResponseSchema = simulatedCallArtifactSchema.pick({
  sourceLanguage: true,
  englishLanguage: true,
  turns: true,
  outcome: true,
});

function buildArtifactSchema() {
  return {
    name: "simulated_call_artifact",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sourceLanguage: { type: "string" },
        englishLanguage: { type: "string" },
        turns: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              seq: { type: "integer" },
              speaker: { type: "string", enum: ["buyer", "seller", "system"] },
              sourceText: { type: "string" },
              englishText: { type: "string" },
              offsetMs: { type: "integer" },
            },
            required: ["seq", "speaker", "sourceText", "englishText", "offsetMs"],
          },
        },
        outcome: {
          type: "object",
          additionalProperties: false,
          properties: {
            result: {
              type: "string",
              enum: ["accepted", "countered", "refused", "no_answer"],
            },
            availabilityStatus: { type: "string" },
            depositRequired: { type: "boolean" },
            holdPossible: { type: "boolean" },
            websiteUrl: { type: "string" },
            whatsappNumber: { type: "string" },
            contactName: { type: "string" },
            contactChannel: { type: "string" },
            confidence: { type: "number" },
            summarySourceText: { type: "string" },
            summaryEnglishText: { type: "string" },
          },
          required: [
            "result",
            "availabilityStatus",
            "depositRequired",
            "holdPossible",
            "websiteUrl",
            "whatsappNumber",
            "contactName",
            "contactChannel",
            "confidence",
            "summarySourceText",
            "summaryEnglishText",
          ],
        },
      },
      required: [
        "sourceLanguage",
        "englishLanguage",
        "turns",
        "outcome",
      ],
    },
  };
}

function buildRefinementSchema() {
  return {
    name: "market_refinement",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        notes: { type: "string" },
        rawNotes: { type: "string" },
        budgetStretchPercent: { type: "integer" },
        budgetDeltaAbsolute: { type: "integer" },
        budgetTargetMax: { type: "integer" },
        localities: {
          type: "array",
          items: { type: "string" },
        },
        mustHaves: {
          type: "array",
          items: { type: "string" },
        },
        niceToHaves: {
          type: "array",
          items: { type: "string" },
        },
        dealBreakers: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["label", "notes", "rawNotes"],
    },
  };
}

function buildLiveCallOutcomeSchema() {
  return {
    name: "live_call_outcome",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        result: {
          type: "string",
          enum: ["accepted", "countered", "refused", "no_answer"],
        },
        availabilityStatus: { type: "string" },
        quotedPrice: { type: "integer" },
        discountOffered: { type: "integer" },
        depositRequired: { type: "boolean" },
        holdPossible: { type: "boolean" },
        websiteUrl: { type: "string" },
        whatsappNumber: { type: "string" },
        contactName: { type: "string" },
        contactChannel: { type: "string" },
        confidence: { type: "number" },
        summarySourceText: { type: "string" },
        summaryEnglishText: { type: "string" },
        structuredDetails: {
          type: "object",
          additionalProperties: true,
          properties: {},
          required: [],
        },
      },
      required: [
        "result",
        "availabilityStatus",
        "depositRequired",
        "holdPossible",
        "websiteUrl",
        "whatsappNumber",
        "contactName",
        "contactChannel",
        "confidence",
        "summarySourceText",
        "summaryEnglishText",
        "structuredDetails",
      ],
    },
  };
}

function buildSystemPrompt() {
  return [
    "You generate deterministic synthetic seller call artifacts for a local-market sourcing app.",
    "Behave like a human business representative in the source-language turns.",
    "Never mention AI, prompts, simulation, tools, system messages, or that this is generated.",
    "Do not invent facts beyond the supplied scenario and evidence.",
    "Keep the conversation concise and realistic, around 4 to 8 turns total when answered.",
    "Return strict JSON only.",
  ].join(" ");
}

function buildRefinementSystemPrompt() {
  return [
    "You convert one natural-language market refinement request into strict JSON.",
    "Only include changes the user explicitly requested.",
    "Do not invent new must-haves, nice-to-haves, localities, or deal-breakers.",
    "Use budgetDeltaAbsolute when the user says to increase the budget by a fixed amount.",
    "Use budgetTargetMax when the user sets a direct budget cap or target.",
    "Use budgetStretchPercent only for percentage-based adjustments.",
    "Keep notes and rawNotes faithful to the request.",
    "Return strict JSON only.",
  ].join(" ");
}

function buildLiveCallOutcomeSystemPrompt() {
  return [
    "You convert a completed real vendor phone call into a structured sourcing outcome.",
    "Base every field only on the supplied transcript, call summary, call plan, and scenario.",
    "Return accepted when the vendor clearly fits and agrees in principle without a material counter.",
    "Return countered when the vendor stays engaged but pushes terms above target or changes a key commercial condition.",
    "Return refused when the vendor cannot fit, declines, or fails a hard requirement.",
    "Return no_answer only when no meaningful live exchange happened.",
    "Do not invent websites, WhatsApp numbers, prices, names, or concessions that are not grounded in the input.",
    "Keep both summaries concise, plain, and faithful.",
    "Return strict JSON only.",
  ].join(" ");
}

function buildDeterministicOutcomeSummary(input: {
  businessName: string;
  result: "accepted" | "countered" | "refused" | "no_answer";
  availabilityStatus: string;
  quotedPrice?: number;
  contactName: string;
  contactChannel: string;
  websiteUrl: string;
  whatsappNumber: string;
}) {
  const contactBits = [
    input.contactName ? `Contact: ${input.contactName}.` : "",
    input.contactChannel ? `Best channel: ${input.contactChannel}.` : "",
    input.whatsappNumber ? `WhatsApp: ${input.whatsappNumber}.` : "",
    input.websiteUrl ? `Website: ${input.websiteUrl}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const priceBit =
    typeof input.quotedPrice === "number" ? `Quoted price is INR ${input.quotedPrice}.` : "";

  if (input.result === "no_answer") {
    const summary = `${input.businessName} did not answer the outreach attempt. No live pricing or contact confirmation was captured.`;
    return {
      sourceText: summary,
      englishText: summary,
    };
  }

  if (input.result === "accepted") {
    const summary = `${input.businessName} confirmed fit with availability marked ${input.availabilityStatus}. ${priceBit} ${contactBits}`.trim();
    return {
      sourceText: summary,
      englishText: summary,
    };
  }

  if (input.result === "countered") {
    const summary = `${input.businessName} stayed engaged but countered on the commercial terms. Availability is ${input.availabilityStatus}. ${priceBit} ${contactBits}`.trim();
    return {
      sourceText: summary,
      englishText: summary,
    };
  }

  const summary = `${input.businessName} did not satisfy the live call requirements. Availability is ${input.availabilityStatus}. ${contactBits}`.trim();
  return {
    sourceText: summary,
    englishText: summary,
  };
}

type OpenAiResponsesPayload = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: { message?: string };
};

function extractResponsesOutputText(payload: OpenAiResponsesPayload | null) {
  if (!payload) {
    return null;
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  for (const outputEntry of payload.output ?? []) {
    for (const contentEntry of outputEntry.content ?? []) {
      if (contentEntry?.type === "output_text" && typeof contentEntry.text === "string" && contentEntry.text.trim()) {
        return contentEntry.text;
      }
    }
  }

  return null;
}

async function requestStructuredOutput<T>(input: {
  model?: string;
  systemPrompt: string;
  userPayload: Record<string, unknown>;
  schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
  errorLabel: string;
}) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || getCallsOpenAiModel(),
      input: [
        {
          role: "system",
          content: input.systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(input.userPayload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...input.schema,
        },
      },
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as OpenAiResponsesPayload | null;
  const outputText = extractResponsesOutputText(payload);

  if (!response.ok || !outputText) {
    const message = payload?.error?.message || `${input.errorLabel} (${response.status}).`;
    throw new Error(message);
  }

  return JSON.parse(outputText) as T;
}

function parseIntegerFromNotes(note: string, pattern: RegExp) {
  const match = note.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1].replaceAll(",", ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseIntegerFromText(note: string, pattern: RegExp) {
  const match = note.match(pattern);

  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1].replaceAll(",", ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function shouldSurfaceRefinementProviderError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /(api key|quota|insufficient|rate limit|unauthorized|invalid|failed \(\d+\))/i.test(
    error.message,
  );
}

function parseRefinementFallback(notes: string): MarketRefinement {
  const localities = Array.from(
    new Set((notes.match(/\bsector\s+\d+[a-z]?\b/gi) ?? []).map((entry) => entry.trim())),
  );
  const budgetStretchPercent = parseIntegerFromNotes(notes, /(\d{1,3})\s*%/i);
  const budgetDeltaAbsolute = parseIntegerFromNotes(
    notes,
    /(?:increase|raise|bump|stretch)(?:\s+the)?\s+budget(?:\s+by)?\s+([\d,]+)/i,
  );
  const budgetTargetMax = parseIntegerFromNotes(
    notes,
    /(?:budget(?:\s+(?:to|at|under|upto|up to|max))?|cap(?:\s+it)?\s+at)\s+([\d,]+)/i,
  );
  const mustHaves = [
    /parking/i.test(notes) ? "Parking" : "",
    /private cabin/i.test(notes) ? "Private cabin" : "",
    /meeting room/i.test(notes) ? "Meeting room" : "",
  ].filter(Boolean);

  return marketRefinementSchema.parse({
    label: "Updated preferences",
    notes,
    rawNotes: notes,
    budgetStretchPercent,
    budgetDeltaAbsolute,
    budgetTargetMax,
    localities: localities.length > 0 ? localities : undefined,
    mustHaves: mustHaves.length > 0 ? mustHaves : undefined,
  });
}

function inferFallbackOutcome(input: {
  candidateName: string;
  sourceLanguage: string;
  transcript: Array<{ speaker: "buyer" | "seller" | "system"; sourceText: string; englishText: string; offsetMs: number }>;
  analysisSummary?: string;
  callPlan: CallPlan;
  sellerScenario: SellerScenario;
  conversationStatus?: string;
}): CallOutcome {
  const summaryText = [input.analysisSummary ?? "", ...input.transcript.map((turn) => turn.englishText)]
    .join(" ")
    .trim();
  const lower = summaryText.toLowerCase();
  const quotedPrice =
    parseIntegerFromText(summaryText, /\b(?:inr|₹|rs\.?)\s*([\d,]+)/i) ??
    input.sellerScenario.finalQuote ??
    input.sellerScenario.baseQuote;
  const discountOffered =
    typeof quotedPrice === "number" && typeof input.sellerScenario.baseQuote === "number"
      ? Math.max(input.sellerScenario.baseQuote - quotedPrice, 0)
      : undefined;

  let result: CallOutcome["result"] = "accepted";

  if (input.transcript.length === 0 || input.conversationStatus === "failed") {
    result = "no_answer";
  } else if (
    /(counter|above budget|higher than|over budget|discount|commercial terms|more than expected|stretch)/i.test(lower)
  ) {
    result = "countered";
  } else if (
    /(not available|unavailable|already booked|cannot help|can't help|not possible|refused|declined|decline)/i.test(
      lower,
    )
  ) {
    result = "refused";
  }

  const availabilityStatus =
    /(unavailable|not available|booked)/i.test(lower)
      ? "unavailable"
      : /(limited|tight availability|waiting list)/i.test(lower)
        ? "limited"
        : input.sellerScenario.availability;
  const summary =
    result === "no_answer"
      ? `${input.candidateName} did not answer the outreach attempt.`
      : input.analysisSummary?.trim() ||
        `${input.candidateName} completed a live outreach call with result ${result.replaceAll("_", " ")}.`;

  return callOutcomeSchema.parse({
    result,
    availabilityStatus,
    quotedPrice,
    discountOffered,
    depositRequired: input.sellerScenario.depositRequired,
    holdPossible: input.sellerScenario.holdPossible,
    websiteUrl: input.sellerScenario.websiteUrl,
    whatsappNumber: input.sellerScenario.whatsappNumber,
    contactName: input.sellerScenario.contactName || "Front desk",
    contactChannel: input.sellerScenario.contactChannel || "phone",
    confidence: result === "accepted" ? 0.64 : result === "countered" ? 0.58 : 0.52,
    summarySourceText: summary,
    summaryEnglishText: summary,
    structuredDetails: {
      fallback: true,
      sourceLanguage: input.sourceLanguage,
      whyCall: input.callPlan.whyCall,
    },
  });
}

export async function parseMarketRefinementFromNaturalLanguage(input: {
  brief: ResearchBrief;
  notes: string;
}) {
  const notes = input.notes.trim();

  if (!notes) {
    throw new Error("Refinement notes are required.");
  }

  try {
    const parsed = await requestStructuredOutput<MarketRefinement>({
      systemPrompt: buildRefinementSystemPrompt(),
      userPayload: {
        brief: {
          category: input.brief.category,
          city: input.brief.city,
          localities: input.brief.localities,
          budget: input.brief.budget,
          mustHaves: input.brief.mustHaves,
          niceToHaves: input.brief.niceToHaves,
          dealBreakers: input.brief.dealBreakers,
          preferredLanguages: input.brief.preferredLanguages,
        },
        refinementRequest: notes,
      },
      schema: buildRefinementSchema(),
      errorLabel: "OpenAI refinement parsing failed",
    });

    return marketRefinementSchema.parse({
      label: parsed.label || "Updated preferences",
      notes,
      rawNotes: notes,
      budgetStretchPercent: parsed.budgetStretchPercent,
      budgetDeltaAbsolute: parsed.budgetDeltaAbsolute,
      budgetTargetMax: parsed.budgetTargetMax,
      localities: parsed.localities,
      mustHaves: parsed.mustHaves,
      niceToHaves: parsed.niceToHaves,
      dealBreakers: parsed.dealBreakers,
    });
  } catch (error) {
    if (shouldSurfaceRefinementProviderError(error)) {
      throw error;
    }

    return parseRefinementFallback(notes);
  }
}

export async function generateSimulatedCallArtifact(input: {
  brief: ResearchBrief;
  candidate: MarketCandidate;
  evidence: MarketCandidateEvidence[];
  callCampaignId: string;
  callingPolicy: CallingPolicy;
  orderIndex: number;
}) {
  const primaryLanguage = selectPrimaryConversationLanguage(input.brief);
  const callPlan = buildCallingPlan(input.brief, input.candidate, input.evidence, input.callingPolicy);
  const scenario = buildSellerScenario(
    input.brief,
    input.candidate,
    input.evidence,
    input.callCampaignId,
    input.callingPolicy,
  );
  const targetResult = deriveCallResult(scenario, input.callingPolicy, input.brief);
  const parsed = openAiCallArtifactResponseSchema.parse(
    await requestStructuredOutput<unknown>({
      systemPrompt: buildSystemPrompt(),
      userPayload: {
        brief: {
          category: input.brief.category,
          city: input.brief.city,
          headcount: input.brief.headcount,
          budget: input.brief.budget,
          preferredLanguages: input.brief.preferredLanguages,
        },
        primaryLanguage,
        candidate: {
          name: input.candidate.displayName,
          locality: input.candidate.locality,
          city: input.candidate.city,
          score: input.candidate.score,
          phone: input.candidate.phone,
          whatsappNumber: input.candidate.whatsappNumber,
          websiteUrl: input.candidate.websiteUrl,
        },
        evidence: input.evidence.map((entry) => ({
          sourceUrl: entry.sourceUrl,
          excerpt: entry.excerpt,
          facts: entry.facts,
          confidence: entry.confidence,
          isFirstParty: entry.isFirstParty,
        })),
        callPlan,
        sellerScenario: scenario,
        requiredResult: targetResult,
        outputRules: {
          answerInSourceLanguage: scenario.targetLanguage,
          provideEnglishTranslation: true,
          keepConversationShort: true,
          noMetaLanguage: true,
        },
      },
      schema: buildArtifactSchema(),
      errorLabel: "OpenAI call generation failed",
    }),
  );
  const quotedPrice = parsed.outcome.quotedPrice ?? scenario.finalQuote;
  const discountOffered =
    parsed.outcome.discountOffered ??
    Math.max((scenario.baseQuote ?? scenario.finalQuote ?? 0) - (scenario.finalQuote ?? 0), 0);
  const summary = buildDeterministicOutcomeSummary({
    businessName: input.candidate.displayName,
    result: targetResult,
    availabilityStatus: parsed.outcome.availabilityStatus || scenario.availability,
    quotedPrice,
    contactName: parsed.outcome.contactName || scenario.contactName,
    contactChannel: parsed.outcome.contactChannel || scenario.contactChannel,
    websiteUrl: parsed.outcome.websiteUrl || scenario.websiteUrl,
    whatsappNumber: parsed.outcome.whatsappNumber || scenario.whatsappNumber,
  });
  const normalizedOutcome = callOutcomeSchema.parse({
    ...parsed.outcome,
    result: targetResult,
    availabilityStatus: parsed.outcome.availabilityStatus || scenario.availability,
    quotedPrice,
    discountOffered,
    depositRequired: scenario.depositRequired,
    holdPossible: scenario.holdPossible,
    websiteUrl: parsed.outcome.websiteUrl || scenario.websiteUrl,
    whatsappNumber: parsed.outcome.whatsappNumber || scenario.whatsappNumber,
    contactName: parsed.outcome.contactName || scenario.contactName,
    contactChannel: parsed.outcome.contactChannel || scenario.contactChannel,
    summarySourceText: summary.sourceText,
    summaryEnglishText: summary.englishText,
  });
  const playback = buildCallPlaybackEnvelope({
    campaignSeed: input.callCampaignId,
    candidateId: input.candidate.id,
    orderIndex: input.orderIndex,
    scenario,
    result: targetResult,
  });
  const turnsForPlayback =
    parsed.outcome.result === targetResult
      ? parsed.turns
      : [];
  const alignedTurns =
    targetResult === "no_answer"
      ? []
      : alignSimulatedTurnsToPlayback(turnsForPlayback, playback);
  const targetDurationMs = playback.callEndMs - playback.laneStartOffsetMs;

  return {
    callPlan,
    sellerScenario: scenario,
    artifact: simulatedCallArtifactSchema.parse({
      ...parsed,
      sourceLanguage: scenario.targetLanguage,
      englishLanguage: "English",
      targetDurationMs,
      callStatusPattern: [],
      playback,
      turns: alignedTurns,
      outcome: normalizedOutcome,
    }) satisfies SimulatedCallArtifact,
  };
}

export async function summarizeLiveCallOutcomeFromTranscript(input: {
  candidateName: string;
  sourceLanguage: string;
  transcript: Array<{
    speaker: "buyer" | "seller" | "system";
    sourceText: string;
    englishText: string;
    offsetMs: number;
  }>;
  analysisSummary?: string;
  conversationStatus?: string;
  callPlan: CallPlan;
  sellerScenario: SellerScenario;
}) {
  const normalizedCallPlan = callPlanSchema.parse(input.callPlan);
  const normalizedScenario = sellerScenarioSchema.parse(input.sellerScenario);
  const spokenTranscript = input.transcript.filter((turn) => turn.speaker !== "system");

  if (spokenTranscript.length === 0) {
    return inferFallbackOutcome({
      candidateName: input.candidateName,
      sourceLanguage: input.sourceLanguage,
      transcript: [],
      analysisSummary: input.analysisSummary,
      callPlan: normalizedCallPlan,
      sellerScenario: normalizedScenario,
      conversationStatus: input.conversationStatus,
    });
  }

  try {
    const parsed = await requestStructuredOutput<unknown>({
      systemPrompt: buildLiveCallOutcomeSystemPrompt(),
      userPayload: {
        candidateName: input.candidateName,
        sourceLanguage: input.sourceLanguage,
        conversationStatus: input.conversationStatus ?? "done",
        analysisSummary: input.analysisSummary ?? "",
        callPlan: normalizedCallPlan,
        sellerScenario: normalizedScenario,
        transcript: spokenTranscript.map((turn) => ({
          speaker: turn.speaker,
          sourceText: turn.sourceText,
          englishText: turn.englishText,
          offsetMs: turn.offsetMs,
        })),
      },
      schema: buildLiveCallOutcomeSchema(),
      errorLabel: "OpenAI live call outcome parsing failed",
    });

    return callOutcomeSchema.parse(parsed);
  } catch {
    return inferFallbackOutcome({
      candidateName: input.candidateName,
      sourceLanguage: input.sourceLanguage,
      transcript: spokenTranscript,
      analysisSummary: input.analysisSummary,
      callPlan: normalizedCallPlan,
      sellerScenario: normalizedScenario,
      conversationStatus: input.conversationStatus,
    });
  }
}
