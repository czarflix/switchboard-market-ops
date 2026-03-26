export const WORKSPACE_STAGE_NAV = [
  { href: "/research", label: "Intake", shortLabel: "I" },
  { href: "/market", label: "Market", shortLabel: "M" },
  { href: "/calls", label: "Calls", shortLabel: "C" },
  { href: "/winner", label: "Winner", shortLabel: "W" },
] as const;

export type WorkspaceStageHref = (typeof WORKSPACE_STAGE_NAV)[number]["href"];
