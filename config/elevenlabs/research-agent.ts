export const RESEARCH_AGENT_NAME = "Switchboard Local Research Intake";
export const RESEARCH_AGENT_VERSION_DESCRIPTION =
  "Code-managed research intake: dense-input trust, v2 handoff token contract, immediate reconcile-safe recovery, Bella voice, Gemini 2.5 Flash Lite tool calling, and Eleven Flash v2 TTS";
export const RESEARCH_AGENT_TOOL_NAME = "save_research_brief_v2";
export const RESEARCH_AGENT_TOOL_PATH = "/api/research/elevenlabs/tool/save-brief";
export const RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME = "Switchboard Local Research Transcript Sync";
export const RESEARCH_AGENT_POST_CALL_WEBHOOK_PATH = "/api/research/elevenlabs/post-call";
export const RESEARCH_AGENT_POST_CALL_WEBHOOK_EVENTS = ["transcript"] as const;
export const RESEARCH_AGENT_DEFAULT_LANGUAGE = "en";
export const RESEARCH_AGENT_TIMEZONE = "Asia/Kolkata";
export const RESEARCH_AGENT_TOOL_LLM = "gemini-2.5-flash-lite";
export const RESEARCH_AGENT_TTS_MODEL = "eleven_flash_v2";
export const RESEARCH_AGENT_TTS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
export const RESEARCH_AGENT_TTS_VOICE_NAME = "Bella";

export type ResearchAgentToolLike = {
  id: string;
  toolConfig?: {
    name?: string | null;
  };
};

export const researchAgentRuntime = {
  serverLocation: "in-residency",
  requiresSignedUrl: true,
  authMode: "signed-url",
} as const;

export const researchAgentTurnConfig = {
  turnTimeout: 7,
  silenceEndCallTimeout: -1,
  softTimeoutConfig: {
    timeoutSeconds: -1,
    message: "Hhmmmm...yeah.",
    useLlmGeneratedMessage: false,
  },
  speculativeTurn: true,
} as const;

export const researchAgentGuardrails = {
  version: "1",
  focus: {
    is_enabled: true,
  },
  prompt_injection: {
    is_enabled: true,
  },
  content: {
    execution_mode: "streaming",
    trigger_action: {
      type: "end_call",
    },
    config: {
      sexual: {
        is_enabled: false,
        threshold: "medium",
      },
      violence: {
        is_enabled: false,
        threshold: "medium",
      },
      harassment: {
        is_enabled: false,
        threshold: "medium",
      },
      self_harm: {
        is_enabled: false,
        threshold: "medium",
      },
      profanity: {
        is_enabled: false,
        threshold: "medium",
      },
      religion_or_politics: {
        is_enabled: false,
        threshold: "medium",
      },
      medical_and_legal_information: {
        is_enabled: false,
        threshold: "medium",
      },
    },
  },
  moderation: {
    execution_mode: "streaming",
    config: {
      sexual: {
        is_enabled: false,
        threshold: 0.3,
      },
      violence: {
        is_enabled: false,
        threshold: 0.3,
      },
      violence_graphic: {
        is_enabled: false,
        threshold: 0.3,
      },
      harassment: {
        is_enabled: false,
        threshold: 0.3,
      },
      harassment_threatening: {
        is_enabled: false,
        threshold: 0.3,
      },
      hate: {
        is_enabled: false,
        threshold: 0.3,
      },
      hate_threatening: {
        is_enabled: false,
        threshold: 0.3,
      },
      self_harm_instructions: {
        is_enabled: false,
        threshold: 0.3,
      },
      self_harm: {
        is_enabled: false,
        threshold: 0.3,
      },
      self_harm_intent: {
        is_enabled: false,
        threshold: 0.3,
      },
      sexual_minors: {
        is_enabled: false,
        threshold: 0.3,
      },
    },
  },
  custom: {
    config: {
      configs: [],
    },
  },
} as const;

export const researchAgentFirstMessage =
  "Hi, I’m your research intake assistant. We are only gathering requirements right now, and the actual market research has not started yet. I’ll ask a few short intake questions, then prepare a written summary for your review before anything proceeds.";

export const researchAgentPrompt = [
  "You are Switchboard Local Research Intake, a voice-first requirements interviewer.",
  "Mission:",
  "- Gather requirements for one market brief.",
  "- Do not do market research yet. Do not browse vendors. Do not recommend venues, coworkers, clinics, or banquets.",
  "- Keep the conversation in intake mode until the required intake fields are collected.",
  "- If the user gives multiple requirements in one answer, absorb them all before asking anything else.",
  "- Trust dense first-turn answers. If the user already stated category, city, headcount, budget, timeline, and preferences clearly, normalize them directly instead of decomposing them into extra confirmation turns.",
  "- Only after the intake is complete, prepare a concise written summary for the brief payload, then save the brief with save_research_brief_v2.",
  "- Ask one question at a time and keep each turn short.",
  "",
  "Style:",
  "- Introduce yourself on the first message.",
  "- Mirror the user’s language in English, Hindi, or Hinglish.",
  "- Be calm, practical, and specific.",
  "- If the request is unclear or internally inconsistent, ask the single most useful follow-up question.",
  "- If the request is adjacent or out of scope, classify it honestly and ask for confirmation before proceeding.",
  "",
  "Supported launch categories:",
  "- banquet",
  "- coworking",
  "- clinic",
  "",
  "Required intake gate before any summary or tool call:",
  "- category",
  "- city",
  "- headcount",
  "- budget",
  "- Headcount means guest count for banquet, team size for coworking, and number of people to accommodate for clinic. If the clinic request is for one person, confirm that explicitly as a headcount of 1.",
  "- If any required intake field is still missing, do not summarize and do not call save_research_brief_v2. Ask the next best follow-up question for the most important missing field.",
  "- If category, city, headcount, and budget are already explicit in the user's answer, do not ask them to repeat or reconfirm those fields.",
  "- Only ask a clarification question when a required field is actually missing, ambiguous, internally inconsistent, or expressed as a range that needs normalization.",
  "- Normalize obvious variants directly: co-working means coworking, Rs 20,000 is valid budget text, one person means headcount 1, and tomorrow is valid timeline text.",
  "- Never fabricate or default a required field. If budget was not explicitly given by the user, budget is still missing.",
  "",
  "Optional details to collect only when they are volunteered or genuinely missing and useful:",
  "- timeline or date window",
  "- must-haves",
  "- nice-to-haves",
  "- deal breakers",
  "- language preference",
  "- category-specific details",
  "- locality preferences",
  "",
  "Hard rules:",
  "- Never say 'I’m starting the research' or anything equivalent. The research happens in the later market phase.",
  "- Explicitly remind the user that the market research has not started yet whenever they ask you to begin researching during intake.",
  "- Never promise final options before the summary is saved.",
  "- Do not produce the written summary until category, city, headcount, and budget are explicit.",
  "- Never call save_research_brief_v2 with placeholder budget text such as 'not specified', 'unknown', 'tbd', or 'flexible' unless the user literally said that as their budget.",
  "- If the user says they have no other demands, nothing else, no preferences, that's all, or no must-haves, treat must_haves, nice_to_haves, and deal_breakers as empty unless the user later adds one.",
  "- Do not ask extra preference questions after the user has clearly said there are no more requirements.",
  "- If the user already gave a dense answer that covers the required intake gate and explicitly says there are no additional demands, skip straight to save_research_brief_v2.",
  "- When enough information exists after the required intake gate, immediately prepare the written brief payload and call save_research_brief_v2. Do not read the written summary aloud.",
  "- Use save_research_brief_v2 exactly for the handoff. That tool is the canonical bridge to the app.",
  "- If save_research_brief_v2 returns JSON with ok false, missingFields, and nextQuestion.prompt, ask nextQuestion.prompt exactly and continue intake. Do not say the handoff line for that case.",
  "- After a save_research_brief_v2 result with nextQuestion.prompt, do not call save_research_brief_v2 again until that missing field is explicitly answered.",
  "- Only if save_research_brief_v2 fails without nextQuestion guidance, say only: 'One moment while I re-check the handoff.' Do not guess which field is missing.",
  "- After save_research_brief_v2 succeeds, say exactly: 'Your market brief is ready for review in the UI.'",
  "- After save_research_brief_v2 succeeds, stop speaking. Do not ask whether the user is still there.",
].join("\n");

export const researchAgentDataCollection = {
  category: {
    type: "string",
    description: "The selected category for the request. Use banquet, coworking, clinic, adjacent, or unclear.",
  },
  scope_status: {
    type: "string",
    description: "Whether the request is supported, adjacent, out_of_scope, or unclear.",
  },
  city: {
    type: "string",
    description: "The main city or locality the user wants to search in.",
  },
  headcount: {
    type: "integer",
    description:
      "The confirmed headcount needed for the brief. Use a positive integer for guest count, team size, or people to accommodate.",
  },
  budget_text: {
    type: "string",
    description:
      "The confirmed budget or price range for the brief as natural language text. Preserve user wording such as Rs 20,000, 20k, or around twenty thousand rupees. Do not use placeholders like not specified or unknown unless the user explicitly said that.",
  },
  summary: {
    type: "string",
    description: "A short written summary of what the later market phase will research.",
  },
  market_query_preview: {
    type: "string",
    description: "A plain-English preview of the search intent for the later market phase.",
  },
};

export const researchAgentToolRequestBodySchema = {
  type: "object",
  description:
    "Persist the final research brief after the agent has gathered enough requirements for a market handoff.",
  required: [
    "summary",
    "market_query_preview",
    "category",
    "scope_status",
    "city",
    "headcount",
    "budget_text",
  ],
  properties: {
    input_mode: {
      type: "string",
      enum: ["voice", "text", "mixed"],
      description: "How the user interacted with the intake session.",
    },
    category: {
      type: "string",
      enum: ["banquet", "coworking", "clinic", "adjacent", "unclear"],
      description: "Normalized category classification for the brief.",
    },
    scope_status: {
      type: "string",
      enum: ["supported", "adjacent", "out_of_scope", "unclear"],
      description: "Whether the request is in scope for the launch brief.",
    },
    country_code: {
      type: "string",
      description: "Country code for the brief. Use IN for this launch.",
    },
    city: {
      type: "string",
      description: "The primary city or market to research.",
    },
    headcount: {
      type: "integer",
      description:
        "Confirmed headcount for the brief. Use a positive integer for guest count, team size, or people to accommodate.",
    },
    localities: {
      type: "array",
      description: "Localities or neighborhoods the user mentioned.",
      items: {
        type: "string",
        description: "One locality or neighborhood mentioned by the user.",
      },
    },
    preferred_languages: {
      type: "array",
      description: "Preferred languages for conversation or results.",
      items: {
        type: "string",
        description: "One preferred language for conversation or results.",
      },
    },
    budget_text: {
      type: "string",
      description:
        "Budget details as natural language text. Examples: 'Rs 20,000', '20k INR daily', 'around twenty thousand rupees'. Do not use placeholder values like 'not specified' unless the user explicitly said that.",
    },
    timeline_text: {
      type: "string",
      description: "Timeline or date window as natural language text.",
    },
    must_haves: {
      type: "array",
      description: "Must-have requirements.",
      items: {
        type: "string",
        description: "One must-have requirement the market phase must honor.",
      },
    },
    nice_to_haves: {
      type: "array",
      description: "Nice-to-have requirements.",
      items: {
        type: "string",
        description: "One optional preference that would improve the result.",
      },
    },
    deal_breakers: {
      type: "array",
      description: "Deal breakers to avoid during market research.",
      items: {
        type: "string",
        description: "One deal breaker or constraint the market phase must avoid.",
      },
    },
    summary: {
      type: "string",
      description:
        "Concise written summary of what will be researched in the market phase. Do not claim market research has already started.",
    },
    market_query_preview: {
      type: "string",
      description: "Plain-English preview of the search query or intent for market research.",
    },
    source_strategy_hint: {
      type: "string",
      description: "Suggested search strategy for downstream market research.",
    },
    category_details: {
      type: "object",
      description:
        "Category-specific details. Fill only the fields that apply; omit irrelevant ones.",
      properties: {
        eventType: {
          type: "string",
          description: "Banquet event type, if relevant.",
        },
        guestCount: {
          type: "integer",
          description: "Approximate guest count for banquet research.",
        },
        dateWindow: {
          type: "string",
          description: "Relevant date window for banquet research.",
        },
        mealPreference: {
          type: "string",
          description: "Meal preference for banquet research.",
        },
        venueStyle: {
          type: "string",
          description: "Venue style preference for banquet research.",
        },
        teamSize: {
          type: "integer",
          description: "Team size for coworking research.",
        },
        membershipType: {
          type: "string",
          description: "Membership type for coworking research.",
        },
        privateCabinNeeded: {
          type: "boolean",
          description: "Whether a private cabin is required for coworking.",
        },
        meetingRoomNeed: {
          type: "string",
          description: "Meeting room need for coworking research.",
        },
        commuteAreas: {
          type: "array",
          description: "Preferred commute areas for coworking research.",
          items: {
            type: "string",
            description: "One preferred commute area for coworking search.",
          },
        },
        specialty: {
          type: "string",
          description: "Clinic specialty, if relevant.",
        },
        visitType: {
          type: "string",
          description: "Clinic visit type, if relevant.",
        },
        urgency: {
          type: "string",
          description: "Clinic urgency, if relevant.",
        },
        insuranceRequired: {
          type: "boolean",
          description: "Whether insurance is required for clinic research.",
        },
        consultMode: {
          type: "string",
          description: "Preferred consult mode for clinic research.",
        },
      },
    },
    conversation_id: {
      type: "string",
      dynamicVariable: "system__conversation_id",
    },
    tool_call_id: {
      type: "string",
      description: "ElevenLabs tool call id if available.",
    },
  },
};

export const researchAgentSimulationCases = [
  {
    name: "intro",
    firstMessage: "Hi, I need help.",
    language: "en",
    newTurnsLimit: 6,
    expectedIncludes: [
      "research intake",
      "market research has not started yet",
    ],
    expectedExcludes: [
      "starting the research",
      "research is beginning now",
      "market research starts now",
    ],
    expectToolCall: false,
  },
  {
    name: "no-premature-research-claim",
    firstMessage: "Please start the research for banquet halls in Mumbai.",
    language: "en",
    newTurnsLimit: 8,
    expectedIncludes: [
      "summary",
      "market phase",
    ],
    expectedExcludes: [
      "starting the research",
      "research is beginning now",
      "research has started",
    ],
    expectToolCall: false,
  },
  {
    name: "missing-mandatory-fields",
    firstMessage: "I need a coworking space in Noida.",
    language: "en",
    newTurnsLimit: 10,
    expectedIncludes: [
      "budget",
      "headcount",
    ],
    expectedExcludes: [
      "starting the research",
      "research has started",
    ],
    expectToolCall: false,
  },
  {
    name: "summary-handoff",
    firstMessage:
      "Need a banquet hall in Mumbai for 150 guests in November. Budget is around 5 lakhs. Vegetarian catering. Near Andheri.",
    language: "en",
    newTurnsLimit: 20,
    expectedIncludes: [
      "ready for review in the ui",
    ],
    expectedExcludes: [
      "what will be researched next",
      "to summarize",
      "starting the research",
      "research is beginning now",
      "are you still there",
    ],
    expectToolCall: true,
    toolMockConfig: {
      save_research_brief_v2: {
        defaultReturnValue: JSON.stringify({ ok: true, saved: true }),
      },
    },
  },
  {
    name: "dense-input-trust",
    firstMessage:
      "I’m looking for a coworking space in Noida for one person for 1000 rupees for tomorrow. I have no other demands.",
    language: "en",
    newTurnsLimit: 12,
    expectedIncludes: [
      "ready for review in the ui",
    ],
    expectedExcludes: [
      "are you still there",
    ],
    expectToolCall: true,
    toolMockConfig: {
      save_research_brief_v2: {
        defaultReturnValue: JSON.stringify({ ok: true, saved: true }),
      },
    },
  },
  {
    name: "tool-error-recovery-neutral",
    firstMessage:
      "I’m looking for a coworking space in Noida for one person tomorrow and my budget is Rs 20,000.",
    language: "en",
    newTurnsLimit: 12,
    expectedIncludes: [
      "one moment while i re-check the handoff",
    ],
    expectedExcludes: [
      "which city",
      "tell me the city",
      "headcount",
      "what is your budget",
    ],
    expectToolCall: true,
    toolMockConfig: {
      save_research_brief_v2: {
        defaultReturnValue: "Failed to prepare webhook parameters.",
        defaultIsError: true,
      },
    },
  },
] as const;

export function assertUniqueSaveResearchBriefTool(tools: ResearchAgentToolLike[]) {
  const matches = tools.filter((tool) => tool.toolConfig?.name === RESEARCH_AGENT_TOOL_NAME);

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${RESEARCH_AGENT_TOOL_NAME} tool, found ${matches.length}. Remove duplicate tools before syncing or verifying.`,
    );
  }

  return matches[0];
}

export function researchAgentSimulationBranchCoverageNote(branchId?: string) {
  if (!branchId) {
    return null;
  }

  return [
    `Branch ${branchId} is configured, but the installed ElevenLabs SDK does not accept branchId for simulateConversation.`,
    "Simulation therefore validates the repo manifest against the main agent surface, while branch-scoped drift must be checked with verify.",
  ].join(" ");
}

export function buildResearchBriefToolConfig(baseUrl: string, intakeSecret: string) {
  return {
    toolConfig: {
      type: "webhook",
      name: RESEARCH_AGENT_TOOL_NAME,
      description:
        "Persist the completed research brief after the intake conversation has enough detail for a market handoff.",
      responseTimeoutSecs: 20,
      disableInterruptions: true,
      executionMode: "immediate",
      toolErrorHandlingMode: "summarized",
      apiSchema: {
        url: new URL(RESEARCH_AGENT_TOOL_PATH, baseUrl).toString(),
        method: "POST",
        contentType: "application/json",
        requestHeaders: {
          "x-research-intake-secret": intakeSecret,
          "x-research-handoff-token": {
            variableName: "secret__handoff_token",
          },
        },
        requestBodySchema: researchAgentToolRequestBodySchema,
      },
    },
  };
}

export function buildResearchPostCallWebhookUrl(
  baseUrl: string,
  intakeSecret: string,
  webhookSecret?: string | null,
) {
  const url = new URL(RESEARCH_AGENT_POST_CALL_WEBHOOK_PATH, baseUrl);

  if (!webhookSecret?.trim()) {
    url.searchParams.set("secret", intakeSecret);
  }

  return url.toString();
}

export function buildResearchAgentUpdateRequest(toolId: string, postCallWebhookId: string) {
  return {
    enableVersioningIfNotEnabled: true,
    name: RESEARCH_AGENT_NAME,
    tags: ["research", "intake", "voice", "india-first"],
    versionDescription: RESEARCH_AGENT_VERSION_DESCRIPTION,
    conversationConfig: {
      turn: researchAgentTurnConfig,
      tts: {
        modelId: RESEARCH_AGENT_TTS_MODEL,
        voiceId: RESEARCH_AGENT_TTS_VOICE_ID,
      },
      agent: {
        firstMessage: researchAgentFirstMessage,
        language: RESEARCH_AGENT_DEFAULT_LANGUAGE,
        hinglishMode: true,
        disableFirstMessageInterruptions: true,
        prompt: {
          prompt: researchAgentPrompt,
          llm: RESEARCH_AGENT_TOOL_LLM,
          toolIds: [toolId],
          ignoreDefaultPersonality: true,
          temperature: 0.2,
          timezone: RESEARCH_AGENT_TIMEZONE,
        },
      },
    },
    platformSettings: {
      auth: {
        enableAuth: true,
        requireOriginHeader: true,
      },
      summaryLanguage: RESEARCH_AGENT_DEFAULT_LANGUAGE,
      dataCollection: researchAgentDataCollection,
      workspaceOverrides: {
        webhooks: {
          postCallWebhookId,
          events: [...RESEARCH_AGENT_POST_CALL_WEBHOOK_EVENTS],
        },
      },
      guardrails: researchAgentGuardrails,
    },
  };
}

export function buildResearchAgentSimulationSpecification(
  firstMessage: string,
  language: string,
  toolMockConfig?: Record<string, { defaultReturnValue?: string; defaultIsError?: boolean }>,
  newTurnsLimit = 20,
) {
  return {
    simulationSpecification: {
      simulatedUserConfig: {
        firstMessage,
        language,
        disableFirstMessageInterruptions: false,
      },
      ...(toolMockConfig ? { toolMockConfig } : {}),
    },
    newTurnsLimit,
  };
}
