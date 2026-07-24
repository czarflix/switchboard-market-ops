import { NextResponse } from "next/server";

import { ensurePreviewAccess } from "@/lib/auth/preview-access";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authorizedUser = await ensurePreviewAccess(user);

  if (!authorizedUser) {
    return NextResponse.json(
      { authorized: false, error: "This account is not authorized for this private preview." },
      { status: 403 },
    );
  }

  return NextResponse.json({ authorized: true });
}
