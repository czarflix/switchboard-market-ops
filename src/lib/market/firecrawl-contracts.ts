export type FirecrawlBatchJob = {
  success: boolean;
  id: string;
  url?: string;
};

export function buildFirecrawlMapBody(input: {
  url: string;
  search: string;
  location?: Record<string, unknown>;
  ignoreCache?: boolean;
  limit?: number;
  timeout?: number;
}) {
  return {
    url: input.url,
    search: input.search,
    sitemap: "include",
    includeSubdomains: false,
    ignoreQueryParameters: true,
    ignoreCache: input.ignoreCache ?? true,
    limit: input.limit ?? 25,
    ...(input.timeout ? { timeout: input.timeout } : {}),
    ...(input.location ? { location: input.location } : {}),
  };
}

export function buildFirecrawlBatchScrapeBody(input: {
  urls: string[];
  webhook: string;
  formats: unknown[];
  onlyMainContent: boolean;
  proxy?: string;
  location?: Record<string, unknown>;
  maxAge?: number;
}) {
  return {
    urls: input.urls,
    webhook: input.webhook,
    formats: input.formats,
    onlyMainContent: input.onlyMainContent,
    ...(input.proxy ? { proxy: input.proxy } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(typeof input.maxAge === "number" ? { maxAge: input.maxAge } : {}),
  };
}

function getFirecrawlErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directMessage = typeof record.message === "string" ? record.message : null;
  if (directMessage) {
    return directMessage;
  }

  if (typeof record.error === "string") {
    return record.error;
  }

  if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
    const nestedMessage = (record.error as Record<string, unknown>).message;
    if (typeof nestedMessage === "string") {
      return nestedMessage;
    }
  }

  return null;
}

function getFirecrawlErrorDetails(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.details)) {
    return [];
  }

  return record.details
    .flatMap((entry) => {
      if (typeof entry === "string") {
        return [entry];
      }

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }

      const detail = entry as Record<string, unknown>;
      const message = typeof detail.message === "string" ? detail.message : null;
      if (message) {
        return [message];
      }

      if (Array.isArray(detail.keys)) {
        return detail.keys
          .filter((key) => typeof key === "string" && key.trim().length > 0)
          .map((key) => `Unrecognized key: "${key}"`);
      }

      return [];
    })
    .filter((entry, index, array) => entry && array.indexOf(entry) === index);
}

export function buildFirecrawlRequestError(
  payload: unknown,
  status: number,
  path: string,
) {
  const message = getFirecrawlErrorMessage(payload);
  const details = getFirecrawlErrorDetails(payload);
  const description = [message, ...details].filter(
    (entry, index, array): entry is string => Boolean(entry) && array.indexOf(entry) === index,
  );

  return new Error(
    description.length > 0
      ? `Firecrawl request failed (${status}) for ${path}: ${description.join("; ")}`
      : `Firecrawl request failed (${status}) for ${path}.`,
  );
}

export function assertSuccessfulFirecrawlPayload<T extends { success?: boolean }>(
  payload: T | null,
  status: number,
  path: string,
) {
  if (!payload) {
    throw buildFirecrawlRequestError(payload, status, path);
  }

  if (payload.success === false) {
    throw buildFirecrawlRequestError(payload, status, path);
  }

  return payload;
}

export function assertValidFirecrawlBatchJob(
  payload: FirecrawlBatchJob | null,
  status: number,
) {
  const parsed = assertSuccessfulFirecrawlPayload(payload, status, "/batch/scrape");
  if (!parsed.id?.trim()) {
    throw new Error("Firecrawl batch scrape did not return a job id.");
  }

  return parsed;
}
