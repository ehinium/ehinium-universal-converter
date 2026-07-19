import type { NormalizedRatesResponse } from "../types/rates";
import { globalProviderFiatCurrencies } from "../data/currencies";
import { getFawazRates } from "./fawaz";
import { getFrankfurterRates } from "./frankfurter";
import { getErrorMessage, hasRates, normalizeBaseCurrency } from "./rateUtils";

const CACHE_TTL_MS = 30 * 60 * 1000;
const RATE_CACHE_STORAGE_PREFIX = "euc-rate-cache-v1:";

type CachedRates = {
  response: NormalizedRatesResponse;
  fetchedAt: number;
  expiresAt: number;
};

export type ExchangeRateStatus = {
  response: NormalizedRatesResponse | null;
  fetchedAt: number | null;
  lastErrorAt: number | null;
};

const ratesCache = new Map<string, CachedRates>();
const rateErrors = new Map<string, number>();
const globalProviderFiatCurrencyCodes = new Set(
  globalProviderFiatCurrencies.map((currency) => currency.code)
);

function getRateCacheStorageKey(base: string): string {
  return `${RATE_CACHE_STORAGE_PREFIX}${base}`;
}

function getLocalStorage(): chrome.storage.StorageArea | null {
  return typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : null;
}

function isRateProvider(value: unknown): value is NormalizedRatesResponse["provider"] {
  return value === "frankfurter" || value === "fawaz" || value === "frankfurter+fawaz";
}

function getValidCachedRates(value: unknown, base: string): CachedRates | null {
  if (typeof value !== "object" || value === null) return null;

  const cached = value as Partial<CachedRates>;
  const response = cached.response;
  if (
    typeof cached.fetchedAt !== "number" ||
    !Number.isFinite(cached.fetchedAt) ||
    typeof cached.expiresAt !== "number" ||
    !Number.isFinite(cached.expiresAt) ||
    typeof response !== "object" ||
    response === null ||
    response.base !== base ||
    typeof response.date !== "string" ||
    !isRateProvider(response.provider) ||
    typeof response.rates !== "object" ||
    response.rates === null
  ) {
    return null;
  }

  const rates = Object.fromEntries(
    Object.entries(response.rates).filter(
      (entry): entry is [string, number] =>
        globalProviderFiatCurrencyCodes.has(entry[0]) &&
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0
    )
  );

  if (rates[base] !== 1 || !hasRates(rates)) return null;

  return {
    response: {
      ...response,
      rates,
    },
    fetchedAt: cached.fetchedAt,
    expiresAt: cached.expiresAt,
  };
}

async function hydrateRateCache(
  base: string,
  preferPersistentSnapshot = false
): Promise<CachedRates | null> {
  const inMemory = ratesCache.get(base);
  if (inMemory && !preferPersistentSnapshot) return inMemory;

  const storage = getLocalStorage();
  if (!storage) return inMemory ?? null;

  try {
    const key = getRateCacheStorageKey(base);
    const stored = await storage.get(key);
    const cached = getValidCachedRates(stored[key], base);
    if (!cached) return inMemory ?? null;
    if (!inMemory || cached.fetchedAt >= inMemory.fetchedAt) {
      ratesCache.set(base, cached);
      return cached;
    }
    return inMemory;
  } catch {
    return inMemory ?? null;
  }
}

async function persistRateCache(base: string, cached: CachedRates): Promise<void> {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    await storage.set({ [getRateCacheStorageKey(base)]: cached });
  } catch {
    // A usable in-memory response must not fail because cache persistence failed.
  }
}

function hasEveryCanonicalFiatRate(response: NormalizedRatesResponse): boolean {
  return globalProviderFiatCurrencies.every(
    (currency) => response.rates[currency.code] !== undefined
  );
}

export function mergeRateResponses(
  primary: NormalizedRatesResponse,
  fallback: NormalizedRatesResponse
): NormalizedRatesResponse {
  if (primary.base !== fallback.base) {
    throw new Error(
      `Cannot merge rate responses with different bases: ${primary.base} and ${fallback.base}`
    );
  }

  return {
    base: primary.base,
    date: primary.date < fallback.date ? primary.date : fallback.date,
    rates: {
      ...fallback.rates,
      ...primary.rates,
    },
    provider: "frankfurter+fawaz",
  };
}

export async function getExchangeRates(
  baseCurrency: string,
  options: { forceRefresh?: boolean } = {}
): Promise<NormalizedRatesResponse> {
  const base = normalizeBaseCurrency(baseCurrency);
  const cached = await hydrateRateCache(base);

  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  let response: NormalizedRatesResponse;

  try {
    response = await getFrankfurterRates(base);

    if (!hasEveryCanonicalFiatRate(response)) {
      try {
        response = mergeRateResponses(response, await getFawazRates(base));
      } catch {
        // A partial primary response remains usable when supplemental fallback
        // rates fail; missing currencies stay explicit to the conversion path.
      }
    }
  } catch (frankfurterError) {
    try {
      response = await getFawazRates(base);
    } catch (fawazError) {
      rateErrors.set(base, Date.now());
      throw new Error(
        `All exchange-rate providers failed. Frankfurter: ${getErrorMessage(
          frankfurterError
        )}. Fawaz: ${getErrorMessage(fawazError)}.`,
        { cause: fawazError }
      );
    }
  }

  const fetchedAt = Date.now();

  const cacheEntry = {
    response,
    fetchedAt,
    expiresAt: fetchedAt + CACHE_TTL_MS,
  };
  ratesCache.set(base, cacheEntry);
  await persistRateCache(base, cacheEntry);
  rateErrors.delete(base);

  return response;
}

export function getExchangeRateStatus(baseCurrency: string): ExchangeRateStatus {
  const base = normalizeBaseCurrency(baseCurrency);
  const cached = ratesCache.get(base);

  return {
    response: cached?.response ?? null,
    fetchedAt: cached?.fetchedAt ?? null,
    lastErrorAt: rateErrors.get(base) ?? null,
  };
}

export async function getCachedExchangeRateStatus(
  baseCurrency: string
): Promise<ExchangeRateStatus> {
  const base = normalizeBaseCurrency(baseCurrency);
  await hydrateRateCache(base, true);
  return getExchangeRateStatus(base);
}

export function refreshExchangeRates(
  baseCurrency: string
): Promise<NormalizedRatesResponse> {
  return getExchangeRates(baseCurrency, { forceRefresh: true });
}
