import { NextResponse } from "next/server";

import { getAuthenticatedUserOrThrow } from "@/lib/auth/get-authenticated-user";
import { signGuideEnvelope } from "@/lib/guide/narration";
import { projectCallCampaignForBrowser } from "@/lib/market/browser";
import {
  getCallCampaignSnapshotForUser,
} from "@/lib/market/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function serializeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserOrThrow();
    const { id } = await context.params;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;

        const closeStream = () => {
          if (closed) {
            return;
          }

          closed = true;
          controller.close();
        };

        const sendSnapshot = async () => {
          if (closed) {
            return false;
          }

          try {
            const snapshot = await getCallCampaignSnapshotForUser(user.id, id);
            if (closed) {
              return false;
            }

            if (!snapshot) {
              controller.enqueue(encoder.encode(serializeEvent("error", { error: "Call campaign not found." })));
              closeStream();
              return false;
            }

            const projection = projectCallCampaignForBrowser(snapshot);
            const signedProjection = {
              ...projection,
              campaign: {
                ...projection.campaign,
                guide: signGuideEnvelope(projection.campaign.guide),
              },
            };
            if (closed) {
              return false;
            }

            controller.enqueue(encoder.encode(serializeEvent("snapshot", signedProjection)));

            if (
              signedProjection.campaign.status === "completed" ||
              signedProjection.campaign.status === "failed" ||
              signedProjection.campaign.status === "cancelled" ||
              signedProjection.campaign.status === "superseded"
            ) {
              controller.enqueue(encoder.encode(serializeEvent("done", signedProjection)));
              closeStream();
              return false;
            }

            return true;
          } catch (error) {
            if (closed) {
              return false;
            }
            const message = error instanceof Error ? error.message : "Unable to stream outreach campaign";
            controller.enqueue(encoder.encode(serializeEvent("error", { error: message })));
            closeStream();
            return false;
          }
        };

        request.signal.addEventListener("abort", closeStream);

        const shouldContinue = await sendSnapshot();
        if (!shouldContinue) {
          return;
        }

        while (!closed) {
          await delay(1000);
          if (closed) {
            break;
          }

          const keepGoing = await sendSnapshot();
          if (!keepGoing) {
            break;
          }
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open outreach stream";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
