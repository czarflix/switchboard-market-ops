import "server-only";

import { ensureJudgeAccess } from "@/lib/auth/judge-access";
import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUserOrThrow() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authorizedUser = await ensureJudgeAccess(user);

  if (!authorizedUser) {
    throw new Error("Unauthorized");
  }

  return authorizedUser;
}
