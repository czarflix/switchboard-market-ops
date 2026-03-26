import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]",
  {
    variants: {
      variant: {
        brass: "border-[color:var(--brand)]/40 bg-[color:var(--brand)]/10 text-[color:var(--brand-strong)]",
        ink: "border-[color:var(--ink)]/12 bg-[color:var(--ink)] text-[color:var(--ink-foreground)]",
        muted: "border-[color:var(--border)] bg-[color:var(--panel-soft)] text-[color:var(--muted)]",
        success: "border-emerald-700/20 bg-emerald-600/10 text-emerald-700",
        warning: "border-amber-700/20 bg-amber-500/10 text-amber-700",
        danger: "border-rose-700/20 bg-rose-500/10 text-rose-700",
      },
    },
    defaultVariants: {
      variant: "muted",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, className }))} {...props} />;
}
