export type WorkspaceStage = {
  href: string;
  label: string;
  shortLabel: string;
};

export const WORKSPACE_STAGES: WorkspaceStage[] = [
  { href: "/research", label: "Intake", shortLabel: "I" },
  { href: "/market", label: "Market", shortLabel: "M" },
  { href: "/calls", label: "Calls", shortLabel: "C" },
  { href: "/winner", label: "Winner", shortLabel: "W" },
];
