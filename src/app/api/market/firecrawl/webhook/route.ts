import { after, NextResponse } from "next/server";

import { processFirecrawlWebhook } from "@/lib/market/repository";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-firecrawl-signature");
  const url = new URL(request.url);
  const marketRunId = url.searchParams.get("marketRunId");

  after(async () => {
    await processFirecrawlWebhook({
      rawBody,
      signatureHeader,
      marketRunId,
    });
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}

