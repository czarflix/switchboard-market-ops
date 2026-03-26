"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { WORKSPACE_RAIL_WIDTH_CLASS } from "./workspace-shell-constants";
import { WORKSPACE_STAGE_NAV } from "./workspace-stage-nav";

export function WorkspaceStageRail() {
  const pathname = usePathname();

  return (
    <aside className={`flex flex-col items-start ${WORKSPACE_RAIL_WIDTH_CLASS}`}>
      {/* Compact named nav card — fits content, doesn't stretch full height */}
      <div
        className="flex w-full flex-col gap-0.5 rounded-[16px] p-1.5"
        style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
      >
        {WORKSPACE_STAGE_NAV.map((stage) => {
          const active =
            pathname === stage.href ||
            (stage.href !== "/research" && pathname.startsWith(`${stage.href}/`));

          return (
            <Link
              key={stage.href}
              href={stage.href}
              prefetch={false}
              title={stage.label}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 transition-all duration-150 hover:opacity-80"
              style={
                active
                  ? {
                      background: "var(--btn-bg)",
                      color: "var(--btn-fg)",
                    }
                  : {
                      background: "transparent",
                      color: "var(--muted)",
                    }
              }
            >
              {/* Step dot */}
              <span
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-black"
                style={
                  active
                    ? { background: "rgba(255,255,255,0.2)", color: "inherit" }
                    : { background: "var(--border)", color: "var(--subtle)" }
                }
              >
                {stage.shortLabel}
              </span>
              <span className="text-[11px] font-bold tracking-[0.04em]">{stage.label}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
