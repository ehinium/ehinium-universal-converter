import type { NormalizedRatesResponse } from "../types/rates";

function expect(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const stored = new Map<string, unknown>();
let networkRequests = 0;

const localStorage = {
  async get(key: string) {
    return { [key]: stored.get(key) };
  },
  async set(values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values)) stored.set(key, value);
  },
};

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: { storage: { local: localStorage } },
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => {
    networkRequests += 1;
    throw new Error("Unexpected network request");
  },
});

const { getCachedExchangeRateStatus, getExchangeRates } = await import("./rates");

function cacheEntry(response: NormalizedRatesResponse, fetchedAt: number, expiresAt: number) {
  return { response, fetchedAt, expiresAt };
}

const now = Date.now();
const usdResponse: NormalizedRatesResponse = {
  base: "USD",
  date: "2026-07-16",
  rates: { USD: 1, EUR: 0.92 },
  provider: "frankfurter",
};
stored.set("euc-rate-cache-v1:USD", cacheEntry(usdResponse, now - 1_000, now + 60_000));

expectEqual(
  await getCachedExchangeRateStatus("EUR"),
  { response: null, fetchedAt: null, lastErrorAt: null },
  "missing cache remains not loaded"
);

const usdStatus = await getCachedExchangeRateStatus("usd");
expectEqual(usdStatus.response, usdResponse, "valid persistent cache hydrates status");
expectEqual(usdStatus.fetchedAt, now - 1_000, "cached timestamp hydrates");
expectEqual(await getExchangeRates("USD"), usdResponse, "fresh cache serves conversion data");
expectEqual(networkRequests, 0, "fresh hydration does not trigger a network request");

const iranianContaminatedResponse: NormalizedRatesResponse = {
  base: "CAD",
  date: "2026-07-16",
  rates: { CAD: 1, USD: 0.73, IRT: 140000, IRR: 1400000 },
  provider: "frankfurter+fawaz",
};
stored.set(
  "euc-rate-cache-v1:CAD",
  cacheEntry(iranianContaminatedResponse, now - 500, now + 60_000)
);
const sanitizedCadStatus = await getCachedExchangeRateStatus("CAD");
expectEqual(sanitizedCadStatus.response?.rates.CAD, 1, "sanitized cache preserves base rate");
expectEqual(sanitizedCadStatus.response?.rates.USD, 0.73, "sanitized cache preserves global rate");
expectEqual(sanitizedCadStatus.response?.rates.IRT, undefined, "persisted IRT is not exposed");
expectEqual(sanitizedCadStatus.response?.rates.IRR, undefined, "persisted IRR is not exposed");
expectEqual(
  await getExchangeRates("CAD"),
  sanitizedCadStatus.response,
  "sanitized fresh global cache remains usable"
);
expectEqual(networkRequests, 0, "sanitized fresh cache avoids network requests");

const newerUsdResponse: NormalizedRatesResponse = {
  ...usdResponse,
  date: "2026-07-17",
  provider: "fawaz",
};
stored.set("euc-rate-cache-v1:USD", cacheEntry(newerUsdResponse, now + 1_000, now + 120_000));
expectEqual(
  (await getCachedExchangeRateStatus("USD")).response,
  newerUsdResponse,
  "status hydration observes a newer snapshot written by another extension context"
);

const fallbackResponse: NormalizedRatesResponse = {
  base: "JPY",
  date: "2026-07-15",
  rates: { JPY: 1, USD: 0.0067 },
  provider: "frankfurter+fawaz",
};
stored.set("euc-rate-cache-v1:JPY", cacheEntry(fallbackResponse, now - 3_600_000, now - 1));
const staleStatus = await getCachedExchangeRateStatus("JPY");
expectEqual(staleStatus.response?.provider, "frankfurter+fawaz", "fallback provider metadata hydrates");
expect(staleStatus.response !== null, "stale but usable cache remains loaded in status");

stored.set("euc-rate-cache-v1:GBP", cacheEntry({
  base: "GBP",
  date: "2026-07-16",
  rates: {},
  provider: "fawaz",
}, now, now + 60_000));
expectEqual(
  (await getCachedExchangeRateStatus("GBP")).response,
  null,
  "empty cached rates are rejected"
);

stored.set("euc-rate-cache-v1:CHF", cacheEntry({
  base: "EUR",
  date: "2026-07-16",
  rates: { EUR: 1, CHF: 0.93 },
  provider: "frankfurter",
}, now, now + 60_000));
expectEqual(
  (await getCachedExchangeRateStatus("CHF")).response,
  null,
  "cache for a different base is rejected"
);
