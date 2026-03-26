import { NextResponse } from "next/server";

import { ensureJudgeAccess } from "@/lib/auth/judge-access";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authorizedUser = await ensureJudgeAccess(user);

  if (!authorizedUser) {
    return NextResponse.json(
      { authorized: false, error: "This account is not authorized for this private preview." },
      { status: 403 },
    );
  }

  return NextResponse.json({ authorized: true });
}
