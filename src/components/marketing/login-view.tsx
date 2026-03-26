"use client";

import { motion } from "framer-motion";

import { AuthPanel } from "@/components/auth/auth-panel";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export function LoginView({
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
  return (
    <MarketingShell>
      {/* Centered auth card */}
      <div className="flex flex-1 items-center justify-center py-10 lg:py-0">
        <motion.div
          className="w-full max-w-[420px]"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.65, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <AuthPanel
            signupEnabled={signupEnabled}
            initialError={initialError}
            forceSignOutUnauthorized={forceSignOutUnauthorized}
            judgeAccessRepoMessage={judgeAccessRepoMessage}
            judgeAccessRepoUrl={judgeAccessRepoUrl}
          />
        </motion.div>
      </div>
    </MarketingShell>
  );
}
