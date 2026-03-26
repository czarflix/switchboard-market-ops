import { redirect } from "next/navigation";

import { LoginView } from "@/components/marketing/login-view";
import { ensureJudgeAccess } from "@/lib/auth/judge-access";
import { getServerEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { judgeSignupEnabled, judgeAccessRepoMessage, judgeAccessRepoUrl } = getServerEnv();
  const authorizedUser = await ensureJudgeAccess(user);

  if (authorizedUser) {
    redirect("/research");
  }

  return (
    <LoginView
      signupEnabled={judgeSignupEnabled}
      initialError={user ? "This account is not authorized for this private preview." : ""}
      forceSignOutUnauthorized={Boolean(user)}
      judgeAccessRepoMessage={judgeAccessRepoMessage}
      judgeAccessRepoUrl={judgeAccessRepoUrl}
    />
  );
}
