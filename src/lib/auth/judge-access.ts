import "server-only";

import type { User } from "@supabase/supabase-js";

type JudgeAccessEnvSource = Record<string, string | undefined>;

const DEFAULT_JUDGE_ACCESS_PUBLISH_AT = "2026-03-26T17:00:00.000Z";
const DEFAULT_JUDGE_ACCESS_PUBLISH_LABEL = "5:00 p.m. UK time on 26 March 2026";

function trimEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function hasJudgeAccess(user: Pick<User, "app_metadata"> | null | undefined) {
  return user?.app_metadata?.judge_access === true;
}

export async function ensureJudgeAccess<T extends Pick<User, "id" | "app_metadata">>(
  user: T | null | undefined,
): Promise<T | null> {
  if (!user) {
    return null;
  }

  if (hasJudgeAccess(user)) {
    return user;
  }

  return null;
}

export function readJudgeAccessConfig(source: JudgeAccessEnvSource) {
  const judgeAccessCode = trimEnv(source.JUDGE_ACCESS_CODE);
  const judgeSignupEnabledFlag = trimEnv(source.JUDGE_SIGNUP_ENABLED);
  const judgeSignupEnabled =
    judgeSignupEnabledFlag === "false"
      ? false
      : Boolean(judgeAccessCode);

  return {
    judgeAccessCode,
    judgeSignupEnabled,
  };
}

export function readJudgeAccessPresentationConfig(
  source: JudgeAccessEnvSource,
  now = new Date(),
) {
  const judgeAccessRepoUrl = trimEnv(source.JUDGE_ACCESS_REPO_URL);
  const judgeAccessPublishAt =
    trimEnv(source.JUDGE_ACCESS_PUBLISH_AT) ?? DEFAULT_JUDGE_ACCESS_PUBLISH_AT;
  const publishAtUnixMs = Number.isNaN(Date.parse(judgeAccessPublishAt))
    ? Date.parse(DEFAULT_JUDGE_ACCESS_PUBLISH_AT)
    : Date.parse(judgeAccessPublishAt);
  const judgeAccessPublished = now.getTime() >= publishAtUnixMs;
  const judgeAccessRepoMessage = judgeAccessRepoUrl
    ? judgeAccessPublished
      ? "Judge access code is published in the GitHub repo README."
      : `Judge access code will be published in the GitHub repo after submissions close at ${DEFAULT_JUDGE_ACCESS_PUBLISH_LABEL}.`
    : "";

  return {
    judgeAccessRepoUrl,
    judgeAccessPublishAt,
    judgeAccessPublished,
    judgeAccessRepoMessage,
  };
}
