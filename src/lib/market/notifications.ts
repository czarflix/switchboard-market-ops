import "server-only";

import { getServerEnv } from "@/lib/env";
import type { WinnerArtifact } from "./schemas.ts";

const RESEND_API_URL = "https://api.resend.com/emails";

export function getAppBaseUrl() {
  return getServerEnv().appBaseUrl.replace(/\/$/, "");
}

async function sendNotificationEmail(input: {
  to: string;
  href: string;
  subject: string;
  intro: string;
  body: string;
  ctaLabel: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Resend email settings are not configured.");
  }

  const html = `
    <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;line-height:1.6">
      <p style="margin:0 0 14px;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#6b7280">
        Switchboard · ElevenLabs · Firecrawl
      </p>
      <p style="margin:0 0 12px">${input.intro}</p>
      <p style="margin:0 0 18px">${input.body}</p>
      <p style="margin:0 0 18px">
        <a href="${input.href}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">
          ${input.ctaLabel}
        </a>
      </p>
      <p style="margin:0 0 12px;color:#374151;font-size:13px">
        Guided by Switchboard, researched with Firecrawl, and narrated with ElevenLabs.
      </p>
      <p style="margin:0;color:#6b7280;font-size:13px">${input.href}</p>
    </div>
  `.trim();

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html,
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        id?: string;
        error?: { message?: string };
      }
    | null;

  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error?.message || `Resend request failed (${response.status}).`);
  }

  return payload.id;
}

export async function sendMarketReadyEmail(input: {
  to: string;
  marketRunId: string;
  researchSessionId: string;
}) {
  return sendNotificationEmail({
    to: input.to,
    href: `${getAppBaseUrl()}/market?researchSessionId=${encodeURIComponent(input.researchSessionId)}&marketRunId=${encodeURIComponent(input.marketRunId)}`,
    subject: "Switchboard market shortlist ready",
    intro: "Firecrawl has finished the current web market sweep.",
    body: "Open the shortlist to review the strongest matches, make your one refinement if needed, and confirm who should move into Switchboard outreach.",
    ctaLabel: "Open market shortlist",
  });
}

export async function sendCallsReadyEmail(input: {
  to: string;
  callCampaignId: string;
  marketRunId: string;
}) {
  return sendNotificationEmail({
    to: input.to,
    href: `${getAppBaseUrl()}/calls?marketRunId=${encodeURIComponent(input.marketRunId)}&callCampaignId=${encodeURIComponent(input.callCampaignId)}`,
    subject: "Switchboard outreach board ready",
    intro: "Switchboard outreach has completed.",
    body: "Open the calls board to review the outcomes, narrated lane summaries, and continue to the winner decision.",
    ctaLabel: "Open outreach board",
  });
}

export async function sendWinnerReadyEmail(input: {
  to: string;
  artifact: WinnerArtifact;
}) {
  return sendNotificationEmail({
    to: input.to,
    href: `${getAppBaseUrl()}/winner?winnerArtifactId=${encodeURIComponent(input.artifact.id)}`,
    subject: "Switchboard final recommendation ready",
    intro: "Your final winner report is ready.",
    body: "Open the winner report to review the final recommendation, Firecrawl-backed evidence, and the next handoff actions.",
    ctaLabel: "Open winner report",
  });
}
