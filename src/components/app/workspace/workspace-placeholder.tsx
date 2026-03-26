import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function WorkspacePlaceholder({
  eyebrow,
  title,
  description,
  researchSessionId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  researchSessionId?: string;
}) {
  const researchHref = researchSessionId
    ? `/research?researchSessionId=${encodeURIComponent(researchSessionId)}`
    : "/research";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="border-b border-[color:var(--border)] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[color:var(--subtle)]">
                {eyebrow}
              </p>
              <CardTitle className="mt-2">{title}</CardTitle>
              <CardDescription className="mt-2 max-w-2xl">{description}</CardDescription>
            </div>
            <Badge variant="muted">Reset baseline</Badge>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col justify-between gap-6 pt-6">
          <div className="max-w-2xl rounded-[1.7rem] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-5 py-5">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[color:var(--subtle)]">
              Next build slice
            </p>
            <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
              This stage now inherits the same authenticated shell as research. Keep the shared header,
              footer, and slim rail stable while the product logic is rebuilt here later.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] pt-5">
            <p className="text-sm text-[color:var(--muted)]">
              The research brief remains the only upstream contract for the next phase.
            </p>
            <Link
              href={researchHref}
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-full bg-[color:var(--btn-bg)] px-5 py-3 text-sm font-bold text-[color:var(--btn-fg)] transition-transform hover:-translate-y-0.5"
            >
              Return to research
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
