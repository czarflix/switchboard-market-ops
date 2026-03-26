"use client";

import { useEffect, useMemo } from "react";

import { Button } from "@/components/ui/button";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const CHUNK_RELOAD_PREFIX = "switchboard-chunk-reload:";

function isRecoverableChunkError(error: Error) {
  const source = `${error.name} ${error.message}`.toLowerCase();

  return (
    source.includes("chunkloaderror") ||
    source.includes("failed to fetch dynamically imported module") ||
    source.includes("loading chunk") ||
    source.includes("imported module")
  );
}

export default function GlobalError({ error, reset }: ErrorProps) {
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
  const reloadKey = useMemo(() => `${CHUNK_RELOAD_PREFIX}${pathname}`, [pathname]);
  const recoverableChunkError = isRecoverableChunkError(error);

  useEffect(() => {
    if (!recoverableChunkError || typeof window === "undefined") {
      return;
    }

    const alreadyReloaded = window.sessionStorage.getItem(reloadKey);
    if (alreadyReloaded) {
      return;
    }

    window.sessionStorage.setItem(reloadKey, "1");
    window.location.reload();
  }, [recoverableChunkError, reloadKey]);

  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center px-6 py-10"
      style={{ background: "#0e0e0e", color: "#eeebe4" }}
    >
      <div
        className="w-full max-w-[560px] rounded-[2rem] border px-8 py-8"
        style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
      >
        <p
          className="text-[10px] font-black uppercase tracking-[0.24em]"
          style={{ color: "rgba(238,235,228,0.45)" }}
        >
          Workspace error
        </p>
        <h1 className="mt-2 font-serif text-[clamp(2rem,5vw,3rem)] leading-[0.96] tracking-[-0.04em]">
          {recoverableChunkError ? "Refreshing the route chunk." : "Something broke in this route."}
        </h1>
        <p className="mt-4 text-sm leading-7" style={{ color: "rgba(238,235,228,0.7)" }}>
          {recoverableChunkError
            ? "A stale route chunk failed to load. The app already tried one hard refresh for this path. If the route still fails, retry manually."
            : error.message || "An unexpected client error occurred."}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => reset()}>Retry route</Button>
          <Button
            variant="outline"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(reloadKey);
                window.location.reload();
              }
            }}
          >
            Hard refresh
          </Button>
        </div>
      </div>
    </div>
  );
}
