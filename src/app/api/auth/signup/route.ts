import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/integrations/supabase";

const signupRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  accessCode: z.string().trim().min(1),
});

function normalizeSignupError(message: string) {
  if (/already (?:registered|been registered)|user already registered/i.test(message)) {
    return "That email is already registered. Sign in instead.";
  }

  return message;
}

export async function POST(request: Request) {
  try {
    const env = getServerEnv();

    if (!env.judgeSignupEnabled || !env.judgeAccessCode) {
      return NextResponse.json(
        { error: "Account creation is currently disabled." },
        { status: 403 },
      );
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      throw new Error("Supabase admin access is not configured.");
    }

    const parsed = signupRequestSchema.parse(await request.json().catch(() => ({})));
    if (parsed.accessCode !== env.judgeAccessCode) {
      return NextResponse.json(
        { error: "That access code is invalid." },
        { status: 403 },
      );
    }

    const created = await admin.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      app_metadata: {
        judge_access: true,
      },
    });

    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Unable to create account.");
    }

    return NextResponse.json({
      userId: created.data.user.id,
      email: created.data.user.email,
    });
  } catch (error) {
    const message =
      error instanceof Error ? normalizeSignupError(error.message) : "Unable to create account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
