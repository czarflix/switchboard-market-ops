"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { createClient } from "@/lib/supabase/client";

type AuthMode = "signin" | "signup";

function normalizeError(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password combination did not match.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first, then sign in.";
  return message;
}

async function apiRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as T | null;
  const error =
    json && typeof json === "object" && "error" in json && typeof (json as { error?: unknown }).error === "string"
      ? (json as { error: string }).error
      : null;
  return { ok: response.ok, data: json, error };
}

export function AuthPanel({
  signupEnabled = true,
  initialError = "",
  forceSignOutUnauthorized = false,
  judgeAccessRepoMessage = "",
  judgeAccessRepoUrl = "",
}: {
  signupEnabled?: boolean;
  initialError?: string;
  forceSignOutUnauthorized?: boolean;
  judgeAccessRepoMessage?: string;
  judgeAccessRepoUrl?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(() => searchParams.get("next") || "/research", [searchParams]);

  const [mode, setMode] = useState<AuthMode>(signupEnabled ? "signin" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionResetPending, setSessionResetPending] = useState(forceSignOutUnauthorized);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!forceSignOutUnauthorized) {
      setSessionResetPending(false);
      return;
    }

    let active = true;

    void createClient()
      .auth
      .signOut()
      .finally(() => {
        if (active) {
          setSessionResetPending(false);
        }
      });

    return () => {
      active = false;
    };
  }, [forceSignOutUnauthorized]);

  async function ensureAuthorizedSession(supabase = createClient()) {
    const access = await apiRequest<{ authorized?: boolean; error?: string }>("/api/auth/access", {
      method: "GET",
    });

    if (!access.ok) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new Error(access.error ?? "This account is not authorized for this private preview.");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || sessionResetPending) {
      return;
    }
    setPending(true);
    setError("");
    setNotice("");

    try {
      const supabase = createClient();

      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        await ensureAuthorizedSession(supabase);
        router.replace(next);
        router.refresh();
        return;
      }

      const signup = await apiRequest<{ userId?: string; error?: string }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, accessCode }),
      });
      if (!signup.ok) {
        throw new Error(signup.error ?? "Account creation failed.");
      }

      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      await ensureAuthorizedSession(supabase);

      router.replace(next);
      router.refresh();
      return;
    } catch (caught) {
      setError(caught instanceof Error ? normalizeError(caught.message) : "Authentication failed.");
    } finally {
      setPending(false);
    }
  }

  const modes = signupEnabled ? (["signin", "signup"] as AuthMode[]) : (["signin"] as AuthMode[]);

  return (
    <div
      className="w-full overflow-hidden rounded-[20px]"
      style={{
        background: "var(--card-strong)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow)",
      }}
    >
      {/* Tab bar */}
      <div className="flex" style={{ borderBottom: "1px solid var(--border)" }}>
        {modes.map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(""); setNotice(""); }}
              className="relative flex-1 py-4 text-[11px] font-black uppercase tracking-[0.2em] transition-colors"
              style={{
                background: "transparent",
                color: active ? "var(--fg)" : "var(--muted)",
              }}
            >
              {m === "signin" ? "Sign in" : "Create account"}
              {active && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 inset-x-0 h-px"
                  style={{ background: "var(--fg)" }}
                  transition={{ type: "spring", damping: 24, stiffness: 220 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Form */}
      <div className="p-7">
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Heading */}
            <div className="mb-7">
              <h2
                className="font-serif text-2xl font-bold leading-tight tracking-tight"
                style={{ color: "var(--fg)" }}
              >
                {mode === "signin" ? "Welcome back" : "Private preview"}
              </h2>
              <p className="mt-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
                {mode === "signin"
                  ? "Sign in to access the operator."
                  : judgeAccessRepoUrl
                    ? "Use the judge access code from the official GitHub repo."
                    : "Create an account with the preview access code."}
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {/* Email */}
              <label className="flex flex-col gap-2">
                <span
                  className="text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{ color: "var(--subtle)" }}
                >
                  Email
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  disabled={pending || sessionResetPending}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  style={{
                    background: "var(--card-strong)",
                    border: "1px solid rgba(128,128,128,0.3)",
                    color: "var(--fg)",
                    caretColor: "var(--accent)",
                  } as CSSProperties}
                />
              </label>

              {/* Password */}
              <label className="flex flex-col gap-2">
                <span
                  className="text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{ color: "var(--subtle)" }}
                >
                  Password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  disabled={pending || sessionResetPending}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  style={{
                    background: "var(--card-strong)",
                    border: "1px solid rgba(128,128,128,0.3)",
                    color: "var(--fg)",
                    caretColor: "var(--accent)",
                  } as CSSProperties}
                />
              </label>

              {mode === "signup" && signupEnabled && (
                <label className="flex flex-col gap-2">
                  <span
                    className="text-[10px] font-black uppercase tracking-[0.22em]"
                    style={{ color: "var(--subtle)" }}
                  >
                    Access code
                  </span>
                  <input
                    type="password"
                    required
                    autoComplete="one-time-code"
                    disabled={pending || sessionResetPending}
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                    style={{
                      background: "var(--card-strong)",
                      border: "1px solid rgba(128,128,128,0.3)",
                      color: "var(--fg)",
                      caretColor: "var(--accent)",
                    } as CSSProperties}
                  />
                  {judgeAccessRepoUrl && judgeAccessRepoMessage ? (
                    <span className="text-[12px] leading-5" style={{ color: "var(--muted)" }}>
                      {judgeAccessRepoMessage}{" "}
                      <a
                        href={judgeAccessRepoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline underline-offset-4"
                        style={{ color: "var(--fg)" }}
                      >
                        Official GitHub repo
                      </a>
                      .
                    </span>
                  ) : null}
                </label>
              )}

              {/* Messages */}
              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="rounded-xl px-4 py-3 text-[13px] font-medium"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgba(239,68,68,0.9)" }}
                  >
                    {error}
                  </motion.p>
                )}
                {notice && (
                  <motion.p
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="rounded-xl px-4 py-3 text-[13px] font-medium"
                    style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", color: "rgba(52,211,153,0.9)" }}
                  >
                    {notice}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button
                type="submit"
                disabled={pending || sessionResetPending}
                className="group mt-1 w-full overflow-hidden rounded-xl py-3.5 text-[13px] font-bold tracking-wide transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" } as CSSProperties}
              >
                <span className="flex items-center justify-center gap-2.5">
                  {pending || sessionResetPending ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      {sessionResetPending
                        ? "Preparing sign-in…"
                        : mode === "signin"
                          ? "Signing in…"
                          : "Creating account…"}
                    </>
                  ) : (
                    <>
                      {mode === "signin" ? "Sign in" : "Create account"}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </span>
              </button>
            </form>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
