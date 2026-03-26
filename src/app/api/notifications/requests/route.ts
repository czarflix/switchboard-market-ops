import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { createNotificationRequestForUser } from "@/lib/market/repository";
import { createNotificationRequestSchema } from "@/lib/market/schemas";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    if (!user.email) {
      return NextResponse.json({ error: "Authenticated user has no email address." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = createNotificationRequestSchema.parse(body);
    const notification = await createNotificationRequestForUser(user.id, user.email, parsed);

    return NextResponse.json({ notification });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create notification request";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

