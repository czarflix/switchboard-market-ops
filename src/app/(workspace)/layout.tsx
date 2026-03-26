import { signOut } from "@/app/actions/auth";
import {
  WorkspaceGuideControls,
  WorkspaceGuideProvider,
} from "@/components/app/workspace/workspace-guide-shell";
import { WorkspaceStageRail } from "@/components/app/workspace/workspace-stage-rail";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <MarketingShell
      authenticated
      className="h-[100dvh] overflow-hidden"
      authenticatedAction={
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition-opacity hover:opacity-70"
            style={{ color: "var(--fg)", borderColor: "var(--border)" }}
          >
            Sign out
          </button>
        </form>
      }
    >
      <WorkspaceGuideProvider>
        <section className="flex min-h-0 flex-1 overflow-hidden py-4">
          <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
            <div className="hidden shrink-0 self-start lg:flex lg:flex-col lg:gap-3">
              <WorkspaceStageRail />
              <WorkspaceGuideControls />
            </div>
            <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <div className="lg:hidden">
                <WorkspaceStageRail />
              </div>
              <div className="lg:hidden">
                <WorkspaceGuideControls mobile />
              </div>
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
            </div>
          </div>
        </section>
      </WorkspaceGuideProvider>
    </MarketingShell>
  );
}
