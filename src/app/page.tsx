import { LandingView } from "@/components/marketing/landing-view";
import { ensureJudgeAccess } from "@/lib/auth/judge-access";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authorizedUser = await ensureJudgeAccess(user);

  return <LandingView authenticated={Boolean(authorizedUser)} />;
}
