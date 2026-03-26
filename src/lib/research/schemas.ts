import { z } from "zod";

export const researchSessionStatusValues = [
  "collecting",
  "review",
  "confirmed",
  "superseded",
  "cancelled",
] as const;

export const scopeStatusValues = [
  "supported",
  "adjacent",
  "out_of_scope",
  "unclear",
] as const;

export const inputModeValues = ["voice", "text", "mixed"] as const;

export const researchCategoryValues = [
  "banquet",
  "coworking",
  "clinic",
  "adjacent",
  "unclear",
] as const;

export const researchSessionStatusSchema = z.enum(researchSessionStatusValues);
export const scopeStatusSchema = z.enum(scopeStatusValues);
export const inputModeSchema = z.enum(inputModeValues);
export const researchCategorySchema = z.enum(researchCategoryValues);

const stringArraySchema = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (Array.isArray(value)) {
      return value.map((item) => item.trim()).filter(Boolean);
    }

    if (typeof value === "string") {
      return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [] as string[];
  });

const NUMBER_WORDS = new Map<string, number>([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

const NUMBER_SCALES = new Map<string, number>([
  ["hundred", 100],
  ["thousand", 1000],
  ["lakh", 100000],
  ["lac", 100000],
  ["crore", 10000000],
]);

function parseIntegerish(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const directNumeric = trimmed.match(/-?\d[\d,]*/)?.[0];

  if (directNumeric) {
    const parsed = Number.parseInt(directNumeric.replaceAll(",", ""), 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  const tokens = trimmed
    .toLowerCase()
    .replaceAll("-", " ")
    .replaceAll(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return undefined;
  }

  let current = 0;
  let total = 0;
  let seen = false;

  for (const token of tokens) {
    const unit = NUMBER_WORDS.get(token);

    if (unit != null) {
      current += unit;
      seen = true;
      continue;
    }

    if (token === "and") {
      continue;
    }

    const scale = NUMBER_SCALES.get(token);

    if (scale == null) {
      continue;
    }

    seen = true;

    if (scale === 100) {
      current = Math.max(current, 1) * scale;
      continue;
    }

    total += Math.max(current, 1) * scale;
    current = 0;
  }

  if (!seen) {
    return undefined;
  }

  return total + current;
}

const integerishSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    return parseIntegerish(value);
  });

const booleanishSchema = z
  .union([z.boolean(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (normalized === "true" || normalized === "yes") {
        return true;
      }

      if (normalized === "false" || normalized === "no") {
        return false;
      }
    }

    return undefined;
  });

export const researchBudgetSchema = z.object({
  currency: z.string().trim().min(1).default("INR"),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
  notes: z.string().trim().optional(),
});

export const researchTimelineSchema = z.object({
  label: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  flexibility: z.string().trim().optional(),
});

export const banquetCategoryDetailsSchema = z.object({
  eventType: z.string().trim().optional(),
  guestCount: integerishSchema.optional(),
  dateWindow: z.string().trim().optional(),
  mealPreference: z.string().trim().optional(),
  venueStyle: z.string().trim().optional(),
}).strict();

export const coworkingCategoryDetailsSchema = z.object({
  teamSize: integerishSchema.optional(),
  membershipType: z.string().trim().optional(),
  privateCabinNeeded: booleanishSchema.optional(),
  meetingRoomNeed: z.string().trim().optional(),
  commuteAreas: stringArraySchema.default([]),
}).strict();

export const clinicCategoryDetailsSchema = z.object({
  specialty: z.string().trim().optional(),
  visitType: z.string().trim().optional(),
  urgency: z.string().trim().optional(),
  insuranceRequired: booleanishSchema.optional(),
  consultMode: z.string().trim().optional(),
}).strict();

export const categoryDetailsSchema = z.union([
  banquetCategoryDetailsSchema,
  coworkingCategoryDetailsSchema,
  clinicCategoryDetailsSchema,
  z.record(z.string(), z.unknown()),
]);

export const researchBriefSchema = z.object({
  id: z.string().uuid(),
  version: z.literal("v1"),
  status: researchSessionStatusSchema,
  inputMode: inputModeSchema,
  category: researchCategorySchema,
  scopeStatus: scopeStatusSchema,
  countryCode: z.string().trim().min(2).default("IN"),
  city: z.string().trim().default(""),
  headcount: z.number().int().nonnegative().default(0),
  localities: stringArraySchema.default([]),
  preferredLanguages: stringArraySchema.default([]),
  budget: researchBudgetSchema.default({ currency: "INR" }),
  timeline: researchTimelineSchema.default({}),
  mustHaves: stringArraySchema.default([]),
  niceToHaves: stringArraySchema.default([]),
  dealBreakers: stringArraySchema.default([]),
  summary: z.string().trim().default(""),
  marketQueryPreview: z.string().trim().default(""),
  sourceStrategyHint: z.string().trim().default("search_then_scrape"),
  missingFields: stringArraySchema.default([]),
  readyForMarket: z.boolean().default(false),
  categoryDetails: categoryDetailsSchema.default({}),
});

export const partialResearchBriefSchema = researchBriefSchema.partial().extend({
  id: z.string().uuid(),
  version: z.literal("v1").optional(),
});

export const researchSessionRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: researchSessionStatusSchema,
  input_mode: inputModeSchema,
  category: researchCategorySchema.nullable(),
  scope_status: scopeStatusSchema.nullable(),
  brief_json: z.record(z.string(), z.unknown()).nullable(),
  resume_context: z.record(z.string(), z.unknown()).nullable(),
  active_conversation_id: z.string().nullable(),
  last_event_seq: z.number().int().nonnegative(),
  started_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
  superseded_at: z.string().nullable(),
});

export const researchMessageRecordSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  role: z.string(),
  modality: z.string(),
  content: z.string(),
  payload_json: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export const researchEventRecordSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  external_event_id: z.string().nullable().optional(),
  kind: z.string(),
  payload_json: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export const researchSessionSnapshotSchema = z.object({
  session: researchSessionRecordSchema,
  brief: researchBriefSchema,
  messages: z.array(researchMessageRecordSchema),
  events: z.array(researchEventRecordSchema),
});

export const researchConversationEventSchema = z.object({
  kind: z.string(),
  sessionId: z.string().uuid(),
  conversationId: z.string().optional(),
  seq: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const researchSessionEventWriteSchema = z.object({
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  seq: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
  conversationId: z.string().optional(),
});

export const createResearchSessionRequestSchema = z.object({
  fresh: z.boolean().optional().default(false),
  inputMode: inputModeSchema.optional().default("voice"),
});

export const researchSignedUrlRequestSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  inputMode: inputModeSchema.optional().default("voice"),
  priorSummary: z.string().optional(),
  missingFields: z.array(z.string()).optional().default([]),
  supportedCategories: z.array(z.string()).optional().default([]),
  dynamicVariables: z.record(z.string(), z.unknown()).optional().default({}),
});

export const saveResearchBriefRouteSchema = z
  .object({
    research_session_id: z.string().uuid(),
    input_mode: inputModeSchema.optional(),
    category: researchCategorySchema,
    scope_status: scopeStatusSchema,
    country_code: z.string().trim().optional(),
    city: z.string().trim().min(1),
    headcount: integerishSchema,
    localities: stringArraySchema.optional(),
    preferred_languages: stringArraySchema.optional(),
    budget: z.union([
      researchBudgetSchema,
      z.string(),
      z.record(z.string(), z.unknown()),
    ]),
    timeline: z
      .union([
        researchTimelineSchema,
        z.string(),
        z.record(z.string(), z.unknown()),
        z.null(),
        z.undefined(),
      ])
      .optional(),
    must_haves: stringArraySchema.optional(),
    nice_to_haves: stringArraySchema.optional(),
    deal_breakers: stringArraySchema.optional(),
    summary: z.string().trim().min(1),
    market_query_preview: z.string().trim().min(1),
    source_strategy_hint: z.string().trim().optional(),
    missing_fields: stringArraySchema.optional(),
    ready_for_market: booleanishSchema.optional(),
    category_details: z
      .union([categoryDetailsSchema, z.string(), z.record(z.string(), z.unknown()), z.null(), z.undefined()])
      .optional(),
    conversation_id: z.string().trim().optional(),
    tool_call_id: z.string().trim().optional(),
  })
  .refine((value) => typeof value.headcount === "number" && value.headcount > 0, {
    message: "headcount is required",
    path: ["headcount"],
  })
  .refine((value) => hasMeaningfulBudget(value.budget), {
    message: "budget is required",
    path: ["budget"],
  })
  .passthrough();

export const saveResearchBriefRouteSchemaV2 = z
  .object({
    input_mode: inputModeSchema.optional(),
    category: researchCategorySchema,
    scope_status: scopeStatusSchema,
    country_code: z.string().trim().optional(),
    city: z.string().trim().min(1),
    headcount: integerishSchema,
    localities: stringArraySchema.optional(),
    preferred_languages: stringArraySchema.optional(),
    budget_text: z.string().trim().min(1),
    timeline_text: z.string().trim().optional(),
    must_haves: stringArraySchema.optional(),
    nice_to_haves: stringArraySchema.optional(),
    deal_breakers: stringArraySchema.optional(),
    summary: z.string().trim().min(1),
    market_query_preview: z.string().trim().min(1),
    source_strategy_hint: z.string().trim().optional(),
    category_details: z
      .union([categoryDetailsSchema, z.string(), z.record(z.string(), z.unknown()), z.null(), z.undefined()])
      .optional(),
    conversation_id: z.string().trim().optional(),
    tool_call_id: z.string().trim().optional(),
  })
  .refine((value) => typeof value.headcount === "number" && value.headcount > 0, {
    message: "headcount is required",
    path: ["headcount"],
  })
  .passthrough();

export const saveResearchBriefToolBodySchema = z.union([
  saveResearchBriefRouteSchema,
  saveResearchBriefRouteSchemaV2,
]);

const researchHandoffIntakeFieldOrder = [
  "category",
  "city",
  "headcount",
  "budget",
] as const;

export type ResearchHandoffIntakeField = (typeof researchHandoffIntakeFieldOrder)[number];

export const updateResearchBriefSchema = z
  .object({
    researchSessionId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    brief: partialResearchBriefSchema,
  })
  .transform((value) => ({
    researchSessionId: value.researchSessionId ?? value.sessionId ?? "",
    sessionId: value.researchSessionId ?? value.sessionId ?? "",
    brief: normalizeResearchBriefHeadcount(value.brief),
  }))
  .refine((value) => Boolean(value.sessionId), {
    message: "researchSessionId is required",
  });

export const confirmResearchSessionSchema = z
  .object({
    researchSessionId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    brief: partialResearchBriefSchema.optional(),
  })
  .transform((value) => ({
    researchSessionId: value.researchSessionId ?? value.sessionId ?? "",
    sessionId: value.researchSessionId ?? value.sessionId ?? "",
    brief: value.brief ? normalizeResearchBriefHeadcount(value.brief) : undefined,
  }))
  .refine((value) => Boolean(value.sessionId), {
    message: "researchSessionId is required",
  });

export const cancelResearchSessionSchema = z
  .object({
    researchSessionId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
  })
  .transform((value) => ({
    researchSessionId: value.researchSessionId ?? value.sessionId ?? "",
    sessionId: value.researchSessionId ?? value.sessionId ?? "",
  }))
  .refine((value) => Boolean(value.sessionId), {
    message: "researchSessionId is required",
  });

export const postCallWebhookSchema = z
  .object({
    research_session_id: z.string().uuid().optional(),
    researchSessionId: z.string().uuid().optional(),
    conversation_id: z.string().trim().optional(),
    conversationId: z.string().trim().optional(),
    event_type: z.string().trim().optional(),
    eventType: z.string().trim().optional(),
    event_id: z.string().trim().optional(),
    eventId: z.string().trim().optional(),
  })
  .passthrough();

export const postCallWebhookPayloadSchema = postCallWebhookSchema;

export type ResearchSessionStatus = z.infer<typeof researchSessionStatusSchema>;
export type ScopeStatus = z.infer<typeof scopeStatusSchema>;
export type InputMode = z.infer<typeof inputModeSchema>;
export type ResearchCategory = z.infer<typeof researchCategorySchema>;
export type ResearchBudget = z.infer<typeof researchBudgetSchema>;
export type ResearchTimeline = z.infer<typeof researchTimelineSchema>;
export type ResearchBrief = z.infer<typeof researchBriefSchema>;
export type PartialResearchBrief = z.infer<typeof partialResearchBriefSchema>;
export type ResearchSessionRecord = z.infer<typeof researchSessionRecordSchema>;
export type ResearchMessageRecord = z.infer<typeof researchMessageRecordSchema>;
export type ResearchEventRecord = z.infer<typeof researchEventRecordSchema>;
export type ResearchSessionSnapshot = z.infer<typeof researchSessionSnapshotSchema>;
export type ResearchConversationEvent = z.infer<typeof researchConversationEventSchema>;
export type ResearchSessionEventWrite = z.infer<typeof researchSessionEventWriteSchema>;
export type ResearchSignedUrlRequest = z.infer<typeof researchSignedUrlRequestSchema>;
export type CreateResearchSessionRequest = z.infer<typeof createResearchSessionRequestSchema>;
export type SaveResearchBriefRoutePayload = z.infer<typeof saveResearchBriefRouteSchema>;
export type SaveResearchBriefRoutePayloadV2 = z.infer<typeof saveResearchBriefRouteSchemaV2>;
export type SaveResearchBriefToolBody = z.infer<typeof saveResearchBriefToolBodySchema>;
export type UpdateResearchBriefRequest = z.infer<typeof updateResearchBriefSchema>;
export type ConfirmResearchSessionRequest = z.infer<typeof confirmResearchSessionSchema>;
export type CancelResearchSessionRequest = z.infer<typeof cancelResearchSessionSchema>;
export type PostCallWebhookPayload = z.infer<typeof postCallWebhookPayloadSchema>;

export const researchSessionMutationLockedErrorMessage =
  "Research session is locked.";

export function assertResearchSessionIsMutable(
  session: Pick<ResearchSessionRecord, "status">,
) {
  if (session.status !== "collecting" && session.status !== "review") {
    throw new Error(researchSessionMutationLockedErrorMessage);
  }
}

export function getResearchSessionMutationErrorStatus(message: string) {
  if (message === researchSessionMutationLockedErrorMessage) {
    return 409;
  }

  return 400;
}

export function createEmptyResearchBrief(
  sessionId: string,
  inputMode: InputMode = "voice",
): ResearchBrief {
  return researchBriefSchema.parse({
    id: sessionId,
    version: "v1",
    status: "collecting",
    inputMode,
    category: "unclear",
    scopeStatus: "unclear",
    countryCode: "IN",
    city: "",
    headcount: 0,
    localities: [],
    preferredLanguages: [],
    budget: { currency: "INR" },
    timeline: {},
    mustHaves: [],
    niceToHaves: [],
    dealBreakers: [],
    summary: "",
    marketQueryPreview: "",
    sourceStrategyHint: "search_then_scrape",
    missingFields: ["category", "city", "headcount", "budget", "summary", "marketQueryPreview"],
    readyForMarket: false,
    categoryDetails: {},
  });
}

type ResearchBriefHeadcountSource = {
  category?: PartialResearchBrief["category"];
  categoryDetails?: PartialResearchBrief["categoryDetails"];
  headcount?: unknown;
};

function getCategoryHeadcountKey(
  category: ResearchBriefHeadcountSource["category"],
  categoryDetails: Record<string, unknown> = {},
) {
  if (category === "banquet" || "guestCount" in categoryDetails) {
    return "guestCount" as const;
  }

  if (category === "coworking" || "teamSize" in categoryDetails) {
    return "teamSize" as const;
  }

  return undefined;
}

function coerceHeadcount(value: unknown) {
  const parsed = integerishSchema.safeParse(value);

  if (!parsed.success) {
    return undefined;
  }

  return typeof parsed.data === "number" && parsed.data > 0 ? parsed.data : undefined;
}

function getCategoryDetailsRecord(brief: ResearchBriefHeadcountSource) {
  return brief.categoryDetails && typeof brief.categoryDetails === "object"
    ? (brief.categoryDetails as Record<string, unknown>)
    : {};
}

function getEffectiveHeadcount(brief: ResearchBriefHeadcountSource) {
  const headcount = coerceHeadcount(brief.headcount);

  if (headcount) {
    return headcount;
  }

  const categoryDetails = getCategoryDetailsRecord(brief);
  const categoryKey = getCategoryHeadcountKey(brief.category, categoryDetails);

  if (!categoryKey) {
    return undefined;
  }

  return coerceHeadcount(categoryDetails[categoryKey]);
}

function hasMeaningfulBudget(budget: unknown) {
  if (!budget) {
    return false;
  }

  if (typeof budget === "string") {
    return Boolean(budget.trim());
  }

  if (typeof budget !== "object") {
    return false;
  }

  const record = budget as Record<string, unknown>;

  return Boolean(
    (typeof record.min === "number" && Number.isFinite(record.min)) ||
      (typeof record.max === "number" && Number.isFinite(record.max)) ||
      (typeof record.notes === "string" && record.notes.trim()),
  );
}

function normalizeBudgetTextValue(
  value: string,
  currentBudget: Partial<ResearchBudget> = {},
): ResearchBudget {
  const trimmed = value.trim();
  const shorthandExpanded = trimmed.replace(
    /\b(\d+(?:\.\d+)?)\s*k\b/gi,
    (_match, amount: string) => String(Math.round(Number(amount) * 1000)),
  );
  const parsedValue = parseIntegerish(shorthandExpanded);

  return researchBudgetSchema.parse({
    currency:
      typeof currentBudget.currency === "string" && currentBudget.currency.trim()
        ? currentBudget.currency.trim()
        : "INR",
    ...(typeof parsedValue === "number" && parsedValue > 0 ? { max: parsedValue } : {}),
    notes: trimmed,
  });
}

type NormalizeSaveResearchBriefToolPayloadOptions = {
  sessionId: string;
  inputMode?: InputMode;
  countryCode?: string;
};

function asSaveResearchBriefToolRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickResearchHandoffCategory(value: unknown) {
  const parsed = researchCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function pickResearchHandoffScopeStatus(value: unknown) {
  const parsed = scopeStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function deriveResearchHandoffScopeStatus(
  category: ResearchCategory | undefined,
  explicitScopeStatus: ScopeStatus | undefined,
) {
  if (explicitScopeStatus) {
    return explicitScopeStatus;
  }

  switch (category) {
    case "banquet":
    case "coworking":
    case "clinic":
      return "supported" satisfies ScopeStatus;
    case "adjacent":
      return "adjacent" satisfies ScopeStatus;
    case "unclear":
      return "unclear" satisfies ScopeStatus;
    default:
      return undefined;
  }
}

function buildResearchHandoffNextQuestion(
  field: ResearchHandoffIntakeField,
  category: ResearchCategory | undefined,
) {
  if (field === "category") {
    return "Which category are you looking for: banquet, coworking, or clinic?";
  }

  if (field === "city") {
    switch (category) {
      case "coworking":
        return "Which city should I look in for the coworking space?";
      case "banquet":
        return "Which city should I look in for the banquet venue?";
      case "clinic":
        return "Which city should I look in for the clinic search?";
      default:
        return "Which city should I look in?";
    }
  }

  if (field === "headcount") {
    switch (category) {
      case "coworking":
        return "How many people should the coworking space accommodate?";
      case "banquet":
        return "How many guests should the banquet accommodate?";
      case "clinic":
        return "How many people should the clinic request accommodate?";
      default:
        return "How many people should this accommodate?";
    }
  }

  switch (category) {
    case "coworking":
      return "What is your budget for the coworking space?";
    case "banquet":
      return "What is your budget for the banquet venue?";
    case "clinic":
      return "What is your budget for the clinic search?";
    default:
      return "What is your budget for this?";
  }
}

function pickResearchHandoffStringArray(value: unknown) {
  if (
    Array.isArray(value) ||
    typeof value === "string" ||
    value === null ||
    value === undefined
  ) {
    return stringArraySchema.parse(value);
  }

  return undefined;
}

function pickResearchHandoffBudget(value: unknown) {
  if (
    typeof value === "string" ||
    (value && typeof value === "object" && !Array.isArray(value))
  ) {
    return value as string | Record<string, unknown>;
  }

  return undefined;
}

function pickResearchHandoffTimeline(value: unknown) {
  if (
    typeof value === "string" ||
    (value && typeof value === "object" && !Array.isArray(value)) ||
    value === null ||
    value === undefined
  ) {
    return value as string | Record<string, unknown> | null | undefined;
  }

  return undefined;
}

function pickResearchHandoffCategoryDetails(value: unknown) {
  if (
    typeof value === "string" ||
    (value && typeof value === "object" && !Array.isArray(value)) ||
    value === null ||
    value === undefined
  ) {
    return value as string | Record<string, unknown> | null | undefined;
  }

  return undefined;
}

function buildResearchHandoffBudgetText(budget: ResearchBudget | undefined) {
  if (!budget) {
    return "";
  }

  if (budget.notes?.trim()) {
    return budget.notes.trim();
  }

  if (typeof budget.min === "number" && typeof budget.max === "number") {
    return `${budget.currency} ${budget.min}-${budget.max}`;
  }

  if (typeof budget.max === "number") {
    return `${budget.currency} ${budget.max}`;
  }

  if (typeof budget.min === "number") {
    return `${budget.currency} ${budget.min}+`;
  }

  return budget.currency;
}

function buildResearchHandoffFallbackSummary(brief: ResearchBrief) {
  const headcountLabel =
    brief.category === "coworking"
      ? `${brief.headcount} ${brief.headcount === 1 ? "person" : "people"}`
      : brief.category === "banquet"
        ? `${brief.headcount} ${brief.headcount === 1 ? "guest" : "guests"}`
        : `${brief.headcount} ${brief.headcount === 1 ? "person" : "people"}`;
  const budgetText = buildResearchHandoffBudgetText(brief.budget);

  return [
    `Researching ${brief.category} options in ${brief.city} for ${headcountLabel}.`,
    budgetText ? `Budget: ${budgetText}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildResearchHandoffFallbackQueryPreview(brief: ResearchBrief) {
  const budgetText = buildResearchHandoffBudgetText(brief.budget);

  return [
    `${brief.category} in ${brief.city}`,
    brief.headcount > 0
      ? `for ${brief.headcount} ${brief.headcount === 1 ? "person" : "people"}`
      : "",
    budgetText ? `with budget ${budgetText}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function normalizeSaveResearchBriefToolPayload(
  value: unknown,
  options: NormalizeSaveResearchBriefToolPayloadOptions,
) {
  const record = asSaveResearchBriefToolRecord(value);

  if (!record) {
    return null;
  }

  const legacyParsed = saveResearchBriefRouteSchema.safeParse({
    ...record,
    research_session_id:
      (typeof record.research_session_id === "string" && record.research_session_id.trim()
        ? record.research_session_id
        : options.sessionId),
    input_mode:
      (typeof record.input_mode === "string" ? record.input_mode : options.inputMode),
    country_code:
      (typeof record.country_code === "string" && record.country_code.trim()
        ? record.country_code
        : options.countryCode),
  });

  if (legacyParsed.success) {
    return legacyParsed.data;
  }

  const v2Parsed = saveResearchBriefRouteSchemaV2.safeParse({
    ...record,
    input_mode:
      (typeof record.input_mode === "string" ? record.input_mode : options.inputMode),
    country_code:
      (typeof record.country_code === "string" && record.country_code.trim()
        ? record.country_code
        : options.countryCode),
  });

  if (!v2Parsed.success) {
    return null;
  }

  const normalized = saveResearchBriefRouteSchema.safeParse({
    research_session_id: options.sessionId,
    input_mode: v2Parsed.data.input_mode ?? options.inputMode,
    category: v2Parsed.data.category,
    scope_status: v2Parsed.data.scope_status,
    country_code: v2Parsed.data.country_code ?? options.countryCode,
    city: v2Parsed.data.city,
    headcount: v2Parsed.data.headcount,
    localities: v2Parsed.data.localities,
    preferred_languages: v2Parsed.data.preferred_languages,
    budget: v2Parsed.data.budget_text,
    timeline: v2Parsed.data.timeline_text
      ? { label: v2Parsed.data.timeline_text }
      : undefined,
    must_haves: v2Parsed.data.must_haves,
    nice_to_haves: v2Parsed.data.nice_to_haves,
    deal_breakers: v2Parsed.data.deal_breakers,
    summary: v2Parsed.data.summary,
    market_query_preview: v2Parsed.data.market_query_preview,
    source_strategy_hint: v2Parsed.data.source_strategy_hint,
    category_details: v2Parsed.data.category_details,
    conversation_id: v2Parsed.data.conversation_id,
    tool_call_id: v2Parsed.data.tool_call_id,
  });

  return normalized.success ? normalized.data : null;
}

export function buildResearchHandoffContinuationGuidance(
  value: unknown,
  options: NormalizeSaveResearchBriefToolPayloadOptions,
) {
  const record = asSaveResearchBriefToolRecord(value);

  if (!record) {
    return null;
  }

  const category = pickResearchHandoffCategory(record.category);
  const scopeStatus = deriveResearchHandoffScopeStatus(
    category,
    pickResearchHandoffScopeStatus(record.scope_status),
  );
  const brief = buildResearchBriefFromPayload(
    {
      research_session_id: options.sessionId,
      input_mode:
        inputModeSchema.safeParse(record.input_mode).success
          ? (record.input_mode as InputMode)
          : options.inputMode,
      category,
      scope_status: scopeStatus,
      country_code:
        typeof record.country_code === "string" && record.country_code.trim()
          ? record.country_code
          : options.countryCode,
      city: typeof record.city === "string" ? record.city.trim() : undefined,
      headcount: coerceHeadcount(record.headcount),
      localities: pickResearchHandoffStringArray(record.localities),
      preferred_languages: pickResearchHandoffStringArray(record.preferred_languages),
      budget:
        typeof record.budget_text === "string"
          ? record.budget_text
          : pickResearchHandoffBudget(record.budget),
      timeline:
        typeof record.timeline_text === "string" && record.timeline_text.trim()
          ? { label: record.timeline_text.trim() }
          : pickResearchHandoffTimeline(record.timeline),
      must_haves: pickResearchHandoffStringArray(record.must_haves),
      nice_to_haves: pickResearchHandoffStringArray(record.nice_to_haves),
      deal_breakers: pickResearchHandoffStringArray(record.deal_breakers),
      summary: typeof record.summary === "string" ? record.summary.trim() : undefined,
      market_query_preview:
        typeof record.market_query_preview === "string"
          ? record.market_query_preview.trim()
          : undefined,
      source_strategy_hint:
        typeof record.source_strategy_hint === "string"
          ? record.source_strategy_hint.trim()
          : undefined,
      category_details: pickResearchHandoffCategoryDetails(record.category_details),
      conversation_id:
        typeof record.conversation_id === "string"
          ? record.conversation_id.trim()
          : undefined,
      tool_call_id:
        typeof record.tool_call_id === "string"
          ? record.tool_call_id.trim()
          : undefined,
    },
    createEmptyResearchBrief(options.sessionId, options.inputMode ?? "voice"),
  );

  const missingFields = computeMissingFields(brief).filter(
    (field): field is ResearchHandoffIntakeField =>
      researchHandoffIntakeFieldOrder.includes(field as ResearchHandoffIntakeField),
  );
  const nextField = missingFields[0] ?? null;

  return {
    missingFields,
    nextField,
    nextQuestion: nextField ? buildResearchHandoffNextQuestion(nextField, category) : null,
  };
}

export function buildResearchHandoffAutofillPayload(
  value: unknown,
  options: NormalizeSaveResearchBriefToolPayloadOptions,
) {
  const record = asSaveResearchBriefToolRecord(value);

  if (!record) {
    return null;
  }

  const category = pickResearchHandoffCategory(record.category);
  const scopeStatus = deriveResearchHandoffScopeStatus(
    category,
    pickResearchHandoffScopeStatus(record.scope_status),
  );
  const brief = buildResearchBriefFromPayload(
    {
      research_session_id: options.sessionId,
      input_mode:
        inputModeSchema.safeParse(record.input_mode).success
          ? (record.input_mode as InputMode)
          : options.inputMode,
      category,
      scope_status: scopeStatus,
      country_code:
        typeof record.country_code === "string" && record.country_code.trim()
          ? record.country_code
          : options.countryCode,
      city: typeof record.city === "string" ? record.city.trim() : undefined,
      headcount: coerceHeadcount(record.headcount),
      localities: pickResearchHandoffStringArray(record.localities),
      preferred_languages: pickResearchHandoffStringArray(record.preferred_languages),
      budget:
        typeof record.budget_text === "string"
          ? record.budget_text
          : pickResearchHandoffBudget(record.budget),
      timeline:
        typeof record.timeline_text === "string" && record.timeline_text.trim()
          ? { label: record.timeline_text.trim() }
          : pickResearchHandoffTimeline(record.timeline),
      must_haves: pickResearchHandoffStringArray(record.must_haves),
      nice_to_haves: pickResearchHandoffStringArray(record.nice_to_haves),
      deal_breakers: pickResearchHandoffStringArray(record.deal_breakers),
      summary: typeof record.summary === "string" ? record.summary.trim() : undefined,
      market_query_preview:
        typeof record.market_query_preview === "string"
          ? record.market_query_preview.trim()
          : undefined,
      source_strategy_hint:
        typeof record.source_strategy_hint === "string"
          ? record.source_strategy_hint.trim()
          : undefined,
      category_details: pickResearchHandoffCategoryDetails(record.category_details),
      conversation_id:
        typeof record.conversation_id === "string"
          ? record.conversation_id.trim()
          : undefined,
      tool_call_id:
        typeof record.tool_call_id === "string"
          ? record.tool_call_id.trim()
          : undefined,
    },
    createEmptyResearchBrief(options.sessionId, options.inputMode ?? "voice"),
  );
  const intakeMissingFields = computeMissingFields(brief).filter((field) =>
    researchHandoffIntakeFieldOrder.includes(field as ResearchHandoffIntakeField),
  );

  if (intakeMissingFields.length > 0) {
    return null;
  }

  const summary =
    typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim()
      : buildResearchHandoffFallbackSummary(brief);
  const marketQueryPreview =
    typeof record.market_query_preview === "string" && record.market_query_preview.trim()
      ? record.market_query_preview.trim()
      : buildResearchHandoffFallbackQueryPreview(brief);

  const normalized = saveResearchBriefRouteSchema.safeParse({
    research_session_id: options.sessionId,
    input_mode: brief.inputMode,
    category: brief.category,
    scope_status: brief.scopeStatus,
    country_code: brief.countryCode,
    city: brief.city,
    headcount: brief.headcount,
    localities: brief.localities,
    preferred_languages: brief.preferredLanguages,
    budget: brief.budget,
    timeline: brief.timeline,
    must_haves: brief.mustHaves,
    nice_to_haves: brief.niceToHaves,
    deal_breakers: brief.dealBreakers,
    summary,
    market_query_preview: marketQueryPreview,
    source_strategy_hint: brief.sourceStrategyHint,
    category_details: brief.categoryDetails,
    conversation_id:
      typeof record.conversation_id === "string"
        ? record.conversation_id.trim()
        : undefined,
    tool_call_id:
      typeof record.tool_call_id === "string"
        ? record.tool_call_id.trim()
        : undefined,
  });

  return normalized.success ? normalized.data : null;
}

type BuildResearchBriefPayload = {
  research_session_id: string;
  input_mode?: InputMode;
  category?: ResearchCategory;
  scope_status?: ScopeStatus;
  country_code?: string;
  city?: string;
  headcount?: number;
  localities?: string[];
  preferred_languages?: string[];
  budget?: ResearchBudget | string | Record<string, unknown>;
  timeline?: ResearchTimeline | string | Record<string, unknown> | null;
  must_haves?: string[];
  nice_to_haves?: string[];
  deal_breakers?: string[];
  summary?: string;
  market_query_preview?: string;
  source_strategy_hint?: string;
  missing_fields?: string[];
  ready_for_market?: boolean;
  category_details?: Record<string, unknown> | string | null;
  conversation_id?: string;
  tool_call_id?: string;
};

export function normalizeResearchBriefHeadcount<T extends ResearchBriefHeadcountSource>(brief: T) {
  const headcount = getEffectiveHeadcount(brief) ?? 0;
  const categoryDetails = { ...getCategoryDetailsRecord(brief) };
  const categoryKey = getCategoryHeadcountKey(brief.category, categoryDetails);

  if (headcount > 0 && categoryKey) {
    categoryDetails[categoryKey] = headcount;
  }

  return {
    ...brief,
    version: "v1" as const,
    headcount,
    categoryDetails,
  } as T & {
    version: "v1";
    headcount: number;
    categoryDetails: Record<string, unknown>;
  };
}

export function computeMissingFields(brief: PartialResearchBrief) {
  const missing = new Set<string>();
  const normalized = normalizeResearchBriefHeadcount(brief);

  if (!normalized.category || normalized.category === "unclear") {
    missing.add("category");
  }

  if (!normalized.city?.trim()) {
    missing.add("city");
  }

  if (!normalized.headcount || normalized.headcount <= 0) {
    missing.add("headcount");
  }

  if (!hasMeaningfulBudget(normalized.budget)) {
    missing.add("budget");
  }

  if (!normalized.summary?.trim()) {
    missing.add("summary");
  }

  if (!normalized.marketQueryPreview?.trim()) {
    missing.add("marketQueryPreview");
  }

  return Array.from(missing);
}

export function computeReadyForMarket(brief: PartialResearchBrief) {
  return computeMissingFields(brief).length === 0;
}

function coerceJsonObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as T;
      }
    } catch {
      return fallback;
    }
  }

  if (value && typeof value === "object") {
    return value as T;
  }

  return fallback;
}

export function buildResearchBriefFromPayload(
  payload: BuildResearchBriefPayload,
  currentBrief?: PartialResearchBrief,
) {
  const currentBudget = currentBrief?.budget ?? { currency: "INR" };
  const parsedBudget =
    typeof payload.budget === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(payload.budget);
            return parsed && typeof parsed === "object"
              ? researchBudgetSchema.parse(parsed)
              : payload.budget.trim()
                ? normalizeBudgetTextValue(payload.budget, currentBudget)
                : currentBrief?.budget;
          } catch {
            return payload.budget.trim()
              ? normalizeBudgetTextValue(payload.budget, currentBudget)
              : currentBrief?.budget;
          }
        })()
      : payload.budget
        ? researchBudgetSchema.parse(payload.budget)
        : currentBrief?.budget;

  const nextBrief: PartialResearchBrief = {
    ...currentBrief,
    version: "v1",
    id: payload.research_session_id,
    status: "review",
    inputMode: payload.input_mode ?? currentBrief?.inputMode ?? "voice",
    category: payload.category ?? currentBrief?.category ?? "unclear",
    scopeStatus: payload.scope_status ?? currentBrief?.scopeStatus ?? "unclear",
    countryCode: payload.country_code ?? currentBrief?.countryCode ?? "IN",
    city: payload.city ?? currentBrief?.city ?? "",
    headcount:
      payload.headcount ??
      currentBrief?.headcount ??
      getEffectiveHeadcount({
        ...currentBrief,
        category: payload.category ?? currentBrief?.category ?? "unclear",
        categoryDetails: coerceJsonObject(
          payload.category_details,
          (currentBrief?.categoryDetails as Record<string, unknown> | undefined) ?? {},
        ),
      }) ??
      0,
    localities: payload.localities ?? currentBrief?.localities ?? [],
    preferredLanguages: payload.preferred_languages ?? currentBrief?.preferredLanguages ?? [],
    mustHaves: payload.must_haves ?? currentBrief?.mustHaves ?? [],
    niceToHaves: payload.nice_to_haves ?? currentBrief?.niceToHaves ?? [],
    dealBreakers: payload.deal_breakers ?? currentBrief?.dealBreakers ?? [],
    summary: payload.summary ?? currentBrief?.summary ?? "",
    marketQueryPreview: payload.market_query_preview ?? currentBrief?.marketQueryPreview ?? "",
    sourceStrategyHint:
      payload.source_strategy_hint ?? currentBrief?.sourceStrategyHint ?? "search_then_scrape",
    categoryDetails: coerceJsonObject(
      payload.category_details,
      (currentBrief?.categoryDetails as Record<string, unknown> | undefined) ?? {},
    ),
    budget: parsedBudget,
    timeline:
      typeof payload.timeline === "string"
        ? currentBrief?.timeline
        : payload.timeline
          ? researchTimelineSchema.parse(payload.timeline)
          : currentBrief?.timeline,
  };

  const normalizedBrief = normalizeResearchBriefHeadcount(nextBrief);

  nextBrief.headcount = normalizedBrief.headcount;
  nextBrief.categoryDetails = normalizedBrief.categoryDetails;
  nextBrief.missingFields = payload.missing_fields ?? computeMissingFields(normalizedBrief);
  nextBrief.readyForMarket = payload.ready_for_market ?? computeReadyForMarket(normalizedBrief);

  return researchBriefSchema.parse(nextBrief);
}

export function buildResumeContext(brief: ResearchBrief) {
  return {
    sessionId: brief.id,
    category: brief.category,
    scopeStatus: brief.scopeStatus,
    city: brief.city,
    headcount: brief.headcount,
    budget: brief.budget,
    summary: brief.summary,
    priorSummary: brief.summary,
    missingFields: brief.missingFields,
    marketQueryPreview: brief.marketQueryPreview,
  } satisfies Record<string, unknown>;
}
