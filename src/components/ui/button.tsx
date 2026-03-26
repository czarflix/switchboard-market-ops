import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-strong)] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "bg-[color:var(--brand)] px-5 py-3 text-[color:var(--brand-foreground)] shadow-[0_18px_45px_rgba(166,108,64,0.22)] hover:-translate-y-0.5 hover:bg-[color:var(--brand-strong)]",
        ink:
          "bg-[color:var(--ink)] px-5 py-3 text-[color:var(--ink-foreground)] shadow-[0_18px_45px_rgba(16,12,10,0.18)] hover:-translate-y-0.5 hover:bg-[color:var(--ink-soft)]",
        outline:
          "border border-[color:var(--border-strong)] bg-transparent px-5 py-3 text-[color:var(--foreground)] hover:bg-[color:var(--panel-strong)]",
        ghost:
          "bg-transparent px-4 py-2 text-[color:var(--muted)] hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--foreground)]",
      },
      size: {
        default: "h-11",
        sm: "h-9 text-xs uppercase tracking-[0.18em]",
        lg: "h-13 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
