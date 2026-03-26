import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

export function getSupabaseAdmin(): SupabaseClient | null {
  const env = getServerEnv();

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function maybePersistRemoteAsset(
  runId: string,
  pathPrefix: string,
  sourceUrl: string | undefined,
): Promise<string | undefined> {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return undefined;
  }

  const supabase = getSupabaseAdmin();
  const env = getServerEnv();
  const bucket = env.supabaseStorageBucket;

  if (!supabase || !bucket) {
    return sourceUrl;
  }

  if (env.supabaseUrl && sourceUrl.startsWith(env.supabaseUrl)) {
    return sourceUrl;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      return sourceUrl;
    }

    const contentType = response.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      return sourceUrl;
    }

    const extension = contentType.includes("jpeg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : "png";

    const arrayBuffer = await response.arrayBuffer();
    const filePath = `${runId}/${pathPrefix}-${crypto.randomUUID()}.${extension}`;
    const upload = await supabase.storage
      .from(bucket)
      .upload(filePath, Buffer.from(arrayBuffer), {
        contentType,
        upsert: true,
      });

    if (upload.error) {
      return sourceUrl;
    }

    const publicUrl = supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl;
    return publicUrl || sourceUrl;
  } catch {
    return sourceUrl;
  }
}
