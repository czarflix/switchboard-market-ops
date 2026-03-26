import { createHmac, timingSafeEqual } from "node:crypto";

const RESEARCH_HANDOFF_TOKEN_TTL_MS = 1000 * 60 * 30;

type ResearchHandoffTokenPayload = {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createResearchHandoffToken(
  sessionId: string,
  secret: string,
  issuedAt = Date.now(),
) {
  const payload: ResearchHandoffTokenPayload = {
    sessionId,
    issuedAt,
    expiresAt: issuedAt + RESEARCH_HANDOFF_TOKEN_TTL_MS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifyResearchHandoffToken(token: string, secret: string) {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("Invalid research handoff token.");
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error("Invalid research handoff token.");
  }

  const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<ResearchHandoffTokenPayload>;

  if (
    typeof parsed.sessionId !== "string" ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    throw new Error("Invalid research handoff token.");
  }

  if (parsed.expiresAt < Date.now()) {
    throw new Error("Research handoff token expired.");
  }

  return parsed as ResearchHandoffTokenPayload;
}

export function resolveResearchHandoffSessionId({
  handoffToken,
  legacySessionId,
  secret,
}: {
  handoffToken?: string | null;
  legacySessionId?: string | null;
  secret?: string | null;
}) {
  const tokenSessionId =
    handoffToken && secret ? verifyResearchHandoffToken(handoffToken, secret).sessionId : null;
  const normalizedLegacySessionId =
    typeof legacySessionId === "string" ? legacySessionId.trim() : "";
  const resolvedSessionId = tokenSessionId ?? normalizedLegacySessionId;

  if (!resolvedSessionId) {
    throw new Error("Research handoff identity was missing.");
  }

  return resolvedSessionId;
}
