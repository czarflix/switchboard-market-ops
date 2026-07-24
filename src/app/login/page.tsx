import { redirect } from "next/navigation";

import { LoginView } from "@/components/marketing/login-view";
import { ensurePreviewAccess } from "@/lib/auth/preview-access";
import { getServerEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { previewSignupEnabled, previewAccessRepoMessage, previewAccessRepoUrl } = getServerEnv();
  const authorizedUser = await ensurePreviewAccess(user);

  if (authorizedUser) {
    redirect("/research");
  }

  return (
    <LoginView
      signupEnabled={previewSignupEnabled}
      initialError={user ? "This account is not authorized for this private preview." : ""}
      forceSignOutUnauthorized={Boolean(user)}
      previewAccessRepoMessage={previewAccessRepoMessage}
      previewAccessRepoUrl={previewAccessRepoUrl}
    />
  );
}
