import type { ExchangeRateStatus } from "../services/rates";
import type { RateProviderName } from "../types/rates";

const providerLabels: Record<RateProviderName, string> = {
  frankfurter: "Frankfurter",
  fawaz: "Fawaz",
};

function formatUpdatedAt(fetchedAt: number, now: number): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - fetchedAt) / 60000));

  if (elapsedMinutes < 1) {
    return "Updated just now";
  }

  if (elapsedMinutes < 60) {
    return `Updated ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Updated ${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
}

export function formatRateStatus(
  status: ExchangeRateStatus,
  now = Date.now()
): string[] {
  if (status.lastErrorAt !== null) {
    return [
      "Failed to load rates",
      status.response ? "Using cached rates" : "Try refreshing again",
    ];
  }

  if (!status.response) {
    return ["Not loaded yet"];
  }

  return [
    status.fetchedAt !== null
      ? formatUpdatedAt(status.fetchedAt, now)
      : `Rates dated ${status.response.date}`,
    `${providerLabels[status.response.provider]} source`,
  ];
}

export async function refreshRateStatus(
  baseCurrency: string,
  fetcher: (baseCurrency: string) => Promise<unknown>
): Promise<void> {
  await fetcher(baseCurrency);
}
