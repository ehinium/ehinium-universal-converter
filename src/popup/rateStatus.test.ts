import type { ExchangeRateStatus } from "../services/rates";
import {
  formatIranianBridgeStatus,
  formatRateStatus,
  getIranianBridgeStatus,
  refreshRateStatus,
} from "./rateStatus";

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

const now = Date.UTC(2026, 5, 15, 12);
const loadedStatus: ExchangeRateStatus = {
  response: {
    base: "USD",
    date: "2026-06-15",
    provider: "frankfurter",
    rates: { USD: 1, EUR: 0.92 },
  },
  fetchedAt: now - 12 * 60000,
  lastErrorAt: null,
};

expectEqual(
  formatRateStatus(loadedStatus, now),
  ["Updated 12 minutes ago", "Frankfurter source"],
  "provider and updated time"
);
expectEqual(
  formatRateStatus({ ...loadedStatus, fetchedAt: null }, now),
  ["Rates dated 2026-06-15", "Frankfurter source"],
  "provider and rate date"
);
expectEqual(
  formatRateStatus({
    ...loadedStatus,
    response: {
      ...loadedStatus.response!,
      provider: "frankfurter+fawaz",
    },
  }, now),
  ["Updated 12 minutes ago", "Frankfurter + Fawaz source"],
  "combined provider provenance"
);
expectEqual(
  formatRateStatus({ response: null, fetchedAt: null, lastErrorAt: null }, now),
  ["Not loaded yet"],
  "missing rate metadata"
);
expectEqual(
  formatRateStatus({ ...loadedStatus, lastErrorAt: now }, now),
  ["Failed to load rates", "Using cached rates"],
  "failed refresh with cache"
);
expectEqual(
  formatRateStatus({ response: null, fetchedAt: null, lastErrorAt: now }, now),
  ["Failed to load rates", "Try refreshing again"],
  "failed refresh without cache"
);

let refreshedBase = "";
await refreshRateStatus("EUR", async (baseCurrency) => {
  refreshedBase = baseCurrency;
});
expectEqual(refreshedBase, "EUR", "refresh calls rate fetcher");

for (const source of ["network", "memory", "storage"] as const) {
  expectEqual(
    getIranianBridgeStatus({
      rate: {
        unit: "IRT",
        usdSellIrt: 200000,
        updatedAt: "2026-06-15T11:40:00Z",
        sourceUpdatedAt: null,
        provider: "ehinium",
      },
      freshness: "fresh",
      source,
    }),
    {
      state: "fresh",
      updatedAt: "2026-06-15T11:40:00Z",
      sourceUpdatedAt: null,
      cacheSource: source,
    },
    `fresh ${source} Iranian status`
  );
}

expectEqual(
  formatIranianBridgeStatus(
    {
      state: "fresh",
      updatedAt: "2026-06-15T11:40:00Z",
      cacheSource: "network",
    },
    now
  ),
  ["Iranian rate", "Ehinium · Updated 20 minutes ago"],
  "fresh Iranian status copy"
);
expectEqual(
  formatIranianBridgeStatus({
    state: "stale",
    refreshError: "Iranian rates refresh failed",
  }),
  ["Iranian rate", "Cached rate · Refresh failed"],
  "stale Iranian status copy"
);
expectEqual(
  formatIranianBridgeStatus({ state: "unavailable" }),
  ["Iranian rate unavailable"],
  "unavailable Iranian status copy"
);
expectEqual(
  formatIranianBridgeStatus({ state: "misconfigured" }),
  ["Iranian rate configuration unavailable"],
  "misconfigured Iranian status copy"
);
expectEqual(
  formatIranianBridgeStatus({ state: "not-required" }),
  [],
  "irrelevant Iranian status is hidden"
);
