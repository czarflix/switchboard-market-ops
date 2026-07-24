import "server-only";

import { redirect } from "next/navigation";

import { ensurePreviewAccess } from "@/lib/auth/preview-access";
import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function requireAuthenticatedUser(nextPath: string) {
  const user = await getAuthenticatedUser();
  const authorizedUser = await ensurePreviewAccess(user);

  if (!authorizedUser) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return authorizedUser;
}
