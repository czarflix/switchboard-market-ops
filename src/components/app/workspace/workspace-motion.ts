"use client";

export const workspaceSpring = {
  type: "spring",
  damping: 20,
  stiffness: 190,
} as const;

export const workspaceSpringFast = {
  type: "spring",
  damping: 24,
  stiffness: 240,
} as const;

export const workspaceReveal = {
  initial: { opacity: 0, y: 18, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -12, scale: 0.99 },
} as const;
