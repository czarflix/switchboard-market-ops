import "server-only";

import {
  assertSuccessfulFirecrawlPayload,
  assertValidFirecrawlBatchJob,
  buildFirecrawlBatchScrapeBody,
  buildFirecrawlMapBody,
  buildFirecrawlRequestError,
  type FirecrawlBatchJob,
} from "./firecrawl-contracts.ts";
import { getServerEnv } from "../env.ts";
import { type ResearchBrief } from "../research/schemas.ts";
import { type MarketSpeedProfile } from "./schemas.ts";
import {
  buildMarketSearchQueries,
  shouldMapSearchResult,
  toFirecrawlLanguageCodes,
} from "./logic.ts";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";

type FirecrawlSearchResult = {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
};

type FirecrawlMapLink = {
  url: string;
  title?: string;
};

type FirecrawlBatchPage = {
  markdown?: string;
  links?: string[];
  json?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type FirecrawlBatchStatus = {
  success?: boolean;
  status: string;
  total?: number;
  completed?: number;
  data?: FirecrawlBatchPage[];
};

function normalizeSearchResults(payload: {
  data?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[] };
  results?: FirecrawlSearchResult[];
  web?: FirecrawlSearchResult[];
}) {
  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (payload.data && typeof payload.data === "object" && Array.isArray(payload.data.web)) {
    return payload.data.web;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (Array.isArray(payload.web)) {
    return payload.web;
  }

  return [];
}

function getFirecrawlApiKey() {
  const apiKey = getServerEnv().firecrawlApiKey;

  if (!apiKey) {
    throw new Error("Firecrawl API key is not configured.");
  }

  return apiKey;
}

async function firecrawlRequest<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getFirecrawlApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    throw buildFirecrawlRequestError(payload, response.status, path);
  }

  return assertSuccessfulFirecrawlPayload(payload as { success?: boolean } | null, response.status, path) as T;
}

async function firecrawlGet<T>(path: string) {
  const response = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getFirecrawlApiKey()}`,
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    throw buildFirecrawlRequestError(payload, response.status, path);
  }

  return assertSuccessfulFirecrawlPayload(payload as { success?: boolean } | null, response.status, path) as T;
}

function buildSearchLocation(brief: ResearchBrief) {
  const parts = [brief.city, brief.countryCode === "IN" ? "India" : brief.countryCode]
    .map((entry) => (entry ?? "").trim())
    .filter(Boolean);

  return parts.join(", ") || "India";
}

function buildScrapeLocation(brief: ResearchBrief) {
  return {
    country: brief.countryCode || "IN",
    languages: toFirecrawlLanguageCodes(brief.preferredLanguages),
  };
}

export function buildCandidateBatchScrapeRequest(
  brief: ResearchBrief,
  urls: string[],
  webhookUrl: string,
  speedProfile: MarketSpeedProfile = "demo_fast",
) {
  return buildFirecrawlBatchScrapeBody({
    urls,
    webhook: webhookUrl,
    formats:
      speedProfile === "demo_fast"
        ? ["markdown", buildCandidateExtractionFormat(brief)]
        : ["markdown", "links", buildCandidateExtractionFormat(brief)],
    onlyMainContent: false,
    proxy: "auto",
    location: buildScrapeLocation(brief),
    maxAge: speedProfile === "demo_fast" ? 86400000 : 3600000,
  });
}

export function buildCandidateExtractionFormat(brief: ResearchBrief) {
  return {
    type: "json",
    prompt:
      `Extract vendor details for this ${brief.category} lead in ${brief.city}. ` +
      "Capture business name, locality, city, address, phone, WhatsApp, website, language, " +
      "budget or price hints, capacity hints, amenities, and a concise summary. " +
      "If a field is missing, omit it rather than inventing it.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        businessName: { type: "string" },
        locality: { type: "string" },
        city: { type: "string" },
        address: { type: "string" },
        phone: { type: "string" },
        whatsappNumber: { type: "string" },
        websiteUrl: { type: "string" },
        sourceLanguage: { type: "string" },
        priceHintMin: { type: "integer" },
        priceHintMax: { type: "integer" },
        capacityMin: { type: "integer" },
        capacityMax: { type: "integer" },
        amenities: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        contactable: { type: "boolean" },
      },
      required: ["businessName", "summary", "amenities", "tags", "contactable"],
    },
  } as const;
}

export function pickSearchSeedUrls(results: FirecrawlSearchResult[]) {
  return Array.from(new Set(results.map((entry) => entry.url).filter(Boolean)));
}

export function buildMapCandidates(
  results: FirecrawlSearchResult[],
  speedProfile: MarketSpeedProfile = "demo_fast",
) {
  return results
    .filter((entry) => shouldMapSearchResult(entry.url))
    .slice(0, speedProfile === "demo_fast" ? 2 : 4);
}

export async function runFirecrawlSearches(
  brief: ResearchBrief,
  speedProfile: MarketSpeedProfile = "demo_fast",
) {
  const queries = buildMarketSearchQueries(brief, speedProfile);
  const location = buildSearchLocation(brief);
  const searchResults = await Promise.all(
    queries.map(async (query) => {
      const payload = await firecrawlRequest<{
        success?: boolean;
        data?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[] };
        results?: FirecrawlSearchResult[];
        web?: FirecrawlSearchResult[];
      }>("/search", {
        query,
        limit: speedProfile === "demo_fast" ? 4 : 5,
        sources: ["web"],
        location,
        ignoreInvalidURLs: true,
        timeout: speedProfile === "demo_fast" ? 8000 : 15000,
        ...(speedProfile === "balanced"
          ? {
              scrapeOptions: {
                formats: ["markdown", "links"],
                onlyMainContent: false,
                maxAge: 3600000,
              },
            }
          : {}),
      });

      return {
        query,
        results: normalizeSearchResults(payload),
      };
    }),
  );

  return {
    queries,
    results: searchResults,
  };
}

export async function mapDomainUrls(
  brief: ResearchBrief,
  url: string,
  search: string,
  speedProfile: MarketSpeedProfile = "demo_fast",
) {
  const payload = await firecrawlRequest<{
    success?: boolean;
    links?: FirecrawlMapLink[];
    data?: { links?: FirecrawlMapLink[] };
  }>(
    "/map",
    buildFirecrawlMapBody({
      url,
      search,
      location: buildScrapeLocation(brief),
      ignoreCache: speedProfile === "balanced",
      limit: speedProfile === "demo_fast" ? 8 : 25,
      timeout: speedProfile === "demo_fast" ? 8000 : 15000,
    }),
  );

  return payload.links ?? payload.data?.links ?? [];
}

export async function startCandidateBatchScrape(
  brief: ResearchBrief,
  urls: string[],
  webhookUrl: string,
  speedProfile: MarketSpeedProfile = "demo_fast",
) {
  const payload = await firecrawlRequest<FirecrawlBatchJob>(
    "/batch/scrape",
    buildCandidateBatchScrapeRequest(brief, urls, webhookUrl, speedProfile),
  );

  return assertValidFirecrawlBatchJob(payload, 200);
}

export async function getBatchScrapeStatus(jobId: string) {
  return firecrawlGet<FirecrawlBatchStatus>(`/batch/scrape/${jobId}`);
}

export async function startFallbackAgentDiscovery(
  brief: ResearchBrief,
  urls: string[],
  webhookUrl: string,
) {
  const payload = await firecrawlRequest<{
    success?: boolean;
    id?: string;
    url?: string;
  }>("/agent", {
    prompt:
      `Find up to 6 additional real ${brief.category} businesses that match this request: ` +
      `${brief.marketQueryPreview || brief.summary}. Return contactable candidate URLs only.`,
    urls,
    strictConstrainToUrls: false,
    maxCredits: 150,
    model: "spark-1-mini",
    webhook: webhookUrl,
  });

  if (!payload.id?.trim()) {
    throw new Error("Firecrawl agent did not return a job id.");
  }

  return payload;
}
