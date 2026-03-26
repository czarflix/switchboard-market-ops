export {
  buildResumeContext,
  cancelResearchSessionSchema,
  confirmResearchSessionSchema,
  createResearchSessionRequestSchema,
  inputModeSchema,
  partialResearchBriefSchema,
  researchBriefSchema,
  researchCategorySchema,
  researchConversationEventSchema as researchSessionEventSchema,
  researchSessionStatusSchema,
  researchSignedUrlRequestSchema as signedUrlRequestSchema,
  saveResearchBriefRouteSchema as saveResearchBriefToolSchema,
  scopeStatusSchema,
  updateResearchBriefSchema,
  type InputMode,
  type PartialResearchBrief,
  type ResearchBrief,
  type ResearchConversationEvent as ResearchSessionEventInput,
  type ResearchSessionStatus,
  type ScopeStatus,
} from "@/lib/research/schemas";
export type { ResearchWorkspaceSessionSnapshot as ResearchSessionSnapshot } from "@/lib/research/presenter";

import { researchBriefSchema } from "@/lib/research/schemas";

export function parseResearchBrief(value: unknown) {
  const parsed = researchBriefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
