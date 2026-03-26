import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import {
  resolveResearchAgentBaseUrl,
  resolveServerResearchAgentEnv,
} from "../../src/lib/research/runtime-env.ts";

export interface ResearchAgentRuntimeEnv {
  apiKey: string;
  firecrawlApiKey?: string;
  openAiApiKey?: string;
  resendApiKey?: string;
  resendFromEmail?: string;
  webhookSecret?: string;
  agentId: string;
  branchId?: string;
  genericAgentId?: string;
  genericBranchId?: string;
  intakeSecret: string;
  baseUrl: string;
}

export interface ResearchAgentBootstrapEnv {
  apiKey: string;
  webhookSecret?: string;
  intakeSecret: string;
  baseUrl: string;
  researchAgentId?: string;
  researchAgentBranchId?: string;
  genericAgentId?: string;
  genericBranchId?: string;
}

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function parseEnvFile(text: string) {
  const entries: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

export function loadEnvFiles() {
  const root = repoRoot();
  for (const fileName of [".env.local", ".env"]) {
    const filePath = resolve(root, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

function requiredEnv(keys: string[]) {
  const missing = keys.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

export function readResearchAgentRuntimeEnv(): ResearchAgentRuntimeEnv {
  loadEnvFiles();

  requiredEnv(["ELEVENLABS_API_KEY", "RESEARCH_INTAKE_SESSION_SECRET"]);
  const researchAgentEnv = resolveServerResearchAgentEnv(process.env);

  if (!researchAgentEnv.researchAgentId) {
    throw new Error(
      "Missing required environment variables: ELEVENLABS_RESEARCH_AGENT_ID",
    );
  }

  return {
    apiKey: process.env.ELEVENLABS_API_KEY!.trim(),
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY?.trim() || undefined,
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
    resendFromEmail: process.env.RESEND_FROM_EMAIL?.trim() || undefined,
    webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET?.trim() || undefined,
    agentId: researchAgentEnv.researchAgentId,
    branchId: researchAgentEnv.researchAgentBranchId,
    genericAgentId: researchAgentEnv.genericAgentId,
    genericBranchId: researchAgentEnv.genericAgentBranchId,
    intakeSecret: process.env.RESEARCH_INTAKE_SESSION_SECRET!.trim(),
    baseUrl: resolveResearchAgentBaseUrl(process.env),
  };
}

export function readResearchAgentBootstrapEnv(): ResearchAgentBootstrapEnv {
  loadEnvFiles();

  requiredEnv(["ELEVENLABS_API_KEY", "RESEARCH_INTAKE_SESSION_SECRET"]);
  const researchAgentEnv = resolveServerResearchAgentEnv(process.env);

  return {
    apiKey: process.env.ELEVENLABS_API_KEY!.trim(),
    webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET?.trim() || undefined,
    intakeSecret: process.env.RESEARCH_INTAKE_SESSION_SECRET!.trim(),
    baseUrl: resolveResearchAgentBaseUrl(process.env),
    researchAgentId: researchAgentEnv.researchAgentId || undefined,
    researchAgentBranchId: researchAgentEnv.researchAgentBranchId || undefined,
    genericAgentId: researchAgentEnv.genericAgentId || undefined,
    genericBranchId: researchAgentEnv.genericAgentBranchId || undefined,
  };
}

function sanitizeVercelEnvValue(value: string | undefined) {
  return value?.replace(/\\n$/u, "").trim();
}

export function readVercelEnvironment(environment: "production" | "preview" | "development" = "production") {
  const tempDir = mkdtempSync(join(tmpdir(), `elevenlabs-vercel-env-${environment}-`));
  const outputPath = join(tempDir, `.env.${environment}`);

  try {
    const result = spawnSync(
      process.env.VERCEL_BIN?.trim() || "vercel",
      ["env", "pull", outputPath, `--environment=${environment}`],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      const stdout = result.stdout?.trim();
      throw new Error(stderr || stdout || `Unable to pull Vercel ${environment} env.`);
    }

    return Object.fromEntries(
      Object.entries(parseEnvFile(readFileSync(outputPath, "utf8"))).map(([key, value]) => [
        key,
        sanitizeVercelEnvValue(value) ?? "",
      ]),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function createElevenLabsClient(apiKey?: string) {
  const resolvedApiKey = apiKey?.trim() || process.env.ELEVENLABS_API_KEY?.trim();

  if (!resolvedApiKey) {
    throw new Error("ELEVENLABS_API_KEY is required.");
  }

  return new ElevenLabsClient({ apiKey: resolvedApiKey });
}

export function maskSecret(secret: string) {
  if (!secret) {
    return "";
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}***`;
  }

  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function sortPrimitiveArray(values: unknown[]) {
  return [...values].sort((left, right) => {
    const leftText = typeof left === "string" ? left : JSON.stringify(left);
    const rightText = typeof right === "string" ? right : JSON.stringify(right);
    return leftText.localeCompare(rightText);
  });
}

export function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeForComparison(entry));
    const primitiveOnly = normalized.every((entry) => entry == null || typeof entry !== "object");
    return primitiveOnly ? sortPrimitiveArray(normalized) : normalized;
  }

  if (value && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeForComparison(entry)] as const);

    return Object.fromEntries(sortedEntries);
  }

  return value;
}

export function stableJson(value: unknown) {
  return JSON.stringify(normalizeForComparison(value), null, 2);
}

export function diffValues(
  expected: unknown,
  actual: unknown,
  path = "$",
  diffs: string[] = [],
) {
  if (expected === actual) {
    return diffs;
  }

  if (expected == null || actual == null) {
    diffs.push(`${path}: expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}`);
    return diffs;
  }

  const expectedType = Array.isArray(expected) ? "array" : typeof expected;
  const actualType = Array.isArray(actual) ? "array" : typeof actual;

  if (expectedType !== actualType) {
    diffs.push(`${path}: expected ${expectedType} but found ${actualType}`);
    return diffs;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const primitiveExpected = expected.every((entry) => entry == null || typeof entry !== "object");
    const primitiveActual = actual.every((entry) => entry == null || typeof entry !== "object");

    if (primitiveExpected && primitiveActual) {
      const expectedList = [...expected].sort((left, right) => String(left).localeCompare(String(right)));
      const actualList = [...actual].sort((left, right) => String(left).localeCompare(String(right)));

      if (JSON.stringify(expectedList) !== JSON.stringify(actualList)) {
        diffs.push(
          `${path}: expected ${JSON.stringify(expectedList)} but found ${JSON.stringify(actualList)}`,
        );
      }

      return diffs;
    }

    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      diffValues(expected[index], actual[index], `${path}[${index}]`, diffs);
    }

    return diffs;
  }

  if (expected && typeof expected === "object" && actual && typeof actual === "object") {
    const keys = new Set([...Object.keys(expected as Record<string, unknown>), ...Object.keys(actual as Record<string, unknown>)]);

    for (const key of Array.from(keys).sort()) {
      diffValues(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        `${path}.${key}`,
        diffs,
      );
    }

    return diffs;
  }

  if (expected !== actual) {
    diffs.push(`${path}: expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}`);
  }

  return diffs;
}

export function collectStrings(value: unknown, output: string[] = [], seen = new WeakSet<object>()) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (!value || typeof value !== "object") {
    return output;
  }

  if (seen.has(value as object)) {
    return output;
  }

  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, output, seen);
    }

    return output;
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    collectStrings(entry, output, seen);
  }

  return output;
}

export function conversationText(value: unknown) {
  return collectStrings(value)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("\n");
}

export function heading(title: string) {
  return `\n=== ${title} ===`;
}
