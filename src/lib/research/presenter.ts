import type {
  InputMode,
  ResearchBrief,
  ResearchCategory,
  ResearchMessageRecord,
  ResearchSessionSnapshot as CanonicalResearchSessionSnapshot,
  ResearchSessionStatus,
  ScopeStatus,
} from "@/lib/research/schemas";

export type { InputMode, ResearchBrief, ResearchCategory, ResearchSessionStatus, ScopeStatus };

export type ResearchMessageRole = "user" | "agent" | "system" | "tool";
export type ResearchMessageModality = "voice" | "text" | "mixed";

export type ResearchMessage = {
  id: string;
  seq: number;
  role: ResearchMessageRole;
  modality: ResearchMessageModality;
  content: string;
  payload?: Record<string, unknown> | null;
  createdAt?: string | null;
  stableKey?: string | null;
  optimistic?: boolean;
};

export type ResearchResumeContext = {
  priorSummary?: string | null;
  missingFields?: string[];
  [key: string]: unknown;
};

export type ResearchWorkspaceSessionSnapshot = {
  id: string;
  status: ResearchSessionStatus;
  inputMode: InputMode;
  category: ResearchCategory | null;
  scopeStatus: ScopeStatus | null;
  brief: ResearchBrief | null;
  resumeContext: ResearchResumeContext | null;
  activeConversationId: string | null;
  lastEventSeq: number | null;
  updatedAt: string | null;
  completedAt: string | null;
  messages: ResearchMessage[];
};

function toResearchMessage(record: ResearchMessageRecord): ResearchMessage {
  return {
    id: record.id,
    seq: record.seq,
    role: record.role as ResearchMessageRole,
    modality: record.modality as ResearchMessageModality,
    content: record.content,
    payload: record.payload_json,
    createdAt: record.created_at,
  };
}

export function flattenResearchSessionSnapshot(
  snapshot: CanonicalResearchSessionSnapshot | null,
): ResearchWorkspaceSessionSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    id: snapshot.session.id,
    status: snapshot.session.status,
    inputMode: snapshot.session.input_mode,
    category: snapshot.session.category ?? snapshot.brief.category ?? null,
    scopeStatus: snapshot.session.scope_status ?? snapshot.brief.scopeStatus ?? null,
    brief: snapshot.brief,
    resumeContext: snapshot.session.resume_context as ResearchResumeContext | null,
    activeConversationId: snapshot.session.active_conversation_id,
    lastEventSeq: snapshot.session.last_event_seq,
    updatedAt: snapshot.session.updated_at,
    completedAt: snapshot.session.completed_at,
    messages: snapshot.messages.map(toResearchMessage),
  };
}
