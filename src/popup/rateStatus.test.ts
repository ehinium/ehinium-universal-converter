import type { ExchangeRateStatus } from "../services/rates";
import { formatRateStatus, refreshRateStatus } from "./rateStatus";

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
