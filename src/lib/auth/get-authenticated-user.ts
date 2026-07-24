import "server-only";

import { ensurePreviewAccess } from "@/lib/auth/preview-access";
import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUserOrThrow() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authorizedUser = await ensurePreviewAccess(user);

  if (!authorizedUser) {
    throw new Error("Unauthorized");
  }

  return authorizedUser;
}
