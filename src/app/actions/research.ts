"use server";

import { redirect } from "next/navigation";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { flattenResearchSessionSnapshot } from "@/lib/research/presenter";
import {
  cancelResearchSessionForUser,
  confirmResearchSessionForUser,
  saveResearchBriefEditsForUser,
  startNewResearchSessionForUser,
} from "@/lib/research/repository";
import {
  cancelResearchSessionSchema,
  confirmResearchSessionSchema,
  createResearchSessionRequestSchema,
  updateResearchBriefSchema,
} from "@/lib/research/schemas";

export async function startNewResearch(formData?: FormData) {
  const user = await getAuthenticatedUserOrThrow();
  const parsed = createResearchSessionRequestSchema.parse({
    fresh: true,
    inputMode: formData?.get("inputMode") ?? undefined,
  });
  const snapshot = await startNewResearchSessionForUser(user.id, parsed.inputMode);

  redirect(`/research?researchSessionId=${snapshot.session.id}`);
}

export async function saveResearchBriefEdits(input: unknown) {
  const user = await getAuthenticatedUserOrThrow();
  const parsed = updateResearchBriefSchema.parse(input);
  const snapshot = await saveResearchBriefEditsForUser(user.id, parsed.sessionId, parsed.brief);

  if (!snapshot) {
    throw new Error("Research session not found.");
  }

  return flattenResearchSessionSnapshot(snapshot);
}

export async function confirmResearchBrief(input: unknown) {
  const user = await getAuthenticatedUserOrThrow();
  const parsed = confirmResearchSessionSchema.parse(input);

  if (parsed.brief) {
    await saveResearchBriefEditsForUser(user.id, parsed.sessionId, parsed.brief);
  }

  const snapshot = await confirmResearchSessionForUser(user.id, parsed.sessionId);

  if (!snapshot) {
    throw new Error("Research session not found.");
  }

  redirect(`/market?researchSessionId=${snapshot.session.id}`);
}

export async function cancelResearchSession(input: unknown) {
  const user = await getAuthenticatedUserOrThrow();
  const parsed = cancelResearchSessionSchema.parse(input);

  await cancelResearchSessionForUser(user.id, parsed.sessionId);
  redirect("/research");
}
