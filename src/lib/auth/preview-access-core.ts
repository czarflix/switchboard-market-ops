import type { User } from "@supabase/supabase-js";

type PreviewAccessEnvSource = Record<string, string | undefined>;

const DEFAULT_PREVIEW_ACCESS_PUBLISH_AT = "2026-03-26T17:00:00.000Z";
const DEFAULT_PREVIEW_ACCESS_PUBLISH_LABEL = "5:00 p.m. UK time on 26 March 2026";

function trimEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function hasPreviewAccess(user: Pick<User, "app_metadata"> | null | undefined) {
  return user?.app_metadata?.preview_access === true;
}

export async function ensurePreviewAccess<T extends Pick<User, "id" | "app_metadata">>(
  user: T | null | undefined,
): Promise<T | null> {
  if (!user) {
    return null;
  }

  if (hasPreviewAccess(user)) {
    return user;
  }

  return null;
}

export function readPreviewAccessConfig(source: PreviewAccessEnvSource) {
  const previewAccessCode = trimEnv(source.PREVIEW_ACCESS_CODE);
  const previewSignupEnabledFlag = trimEnv(source.PREVIEW_SIGNUP_ENABLED);
  const previewSignupEnabled =
    previewSignupEnabledFlag === "false"
      ? false
      : Boolean(previewAccessCode);

  return {
    previewAccessCode,
    previewSignupEnabled,
  };
}

export function readPreviewAccessPresentationConfig(
  source: PreviewAccessEnvSource,
  now = new Date(),
) {
  const previewAccessRepoUrl = trimEnv(source.PREVIEW_ACCESS_REPO_URL);
  const previewAccessPublishAt =
    trimEnv(source.PREVIEW_ACCESS_PUBLISH_AT) ?? DEFAULT_PREVIEW_ACCESS_PUBLISH_AT;
  const publishAtUnixMs = Number.isNaN(Date.parse(previewAccessPublishAt))
    ? Date.parse(DEFAULT_PREVIEW_ACCESS_PUBLISH_AT)
    : Date.parse(previewAccessPublishAt);
  const previewAccessPublished = now.getTime() >= publishAtUnixMs;
  const previewAccessRepoMessage = previewAccessRepoUrl
    ? previewAccessPublished
      ? "Preview access is configured through private deployment settings."
      : `Preview access details are managed privately until ${DEFAULT_PREVIEW_ACCESS_PUBLISH_LABEL}.`
    : "";

  return {
    previewAccessRepoUrl,
    previewAccessPublishAt,
    previewAccessPublished,
    previewAccessRepoMessage,
  };
}
