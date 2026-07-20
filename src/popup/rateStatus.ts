import type { ExchangeRateStatus } from "../services/rates";
import type { RateProviderName } from "../types/rates";
import type { IranianBridgeClientResult } from "../services/iranianBridgeClient";

export type IranianBridgeStatus = {
  state:
    | "not-required"
    | "loading"
    | "fresh"
    | "stale"
    | "unavailable"
    | "misconfigured";
  updatedAt?: string;
  sourceUpdatedAt?: string | null;
  cacheSource?: "memory" | "storage" | "network";
  refreshError?: string;
};

export type CombinedRateStatus = ExchangeRateStatus & {
  iranianBridgeStatus?: IranianBridgeStatus;
};

export const notRequiredIranianBridgeStatus: IranianBridgeStatus = {
  state: "not-required",
};

const providerLabels: Record<RateProviderName, string> = {
  frankfurter: "Frankfurter",
  fawaz: "Fawaz",
  "frankfurter+fawaz": "Frankfurter + Fawaz",
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

export function getIranianBridgeStatus(
  result: IranianBridgeClientResult
): IranianBridgeStatus {
  return {
    state: result.freshness,
    updatedAt: result.rate.updatedAt,
    sourceUpdatedAt: result.rate.sourceUpdatedAt,
    cacheSource: result.source,
    ...(result.refreshError === undefined
      ? {}
      : { refreshError: result.refreshError }),
  };
}

export function formatIranianBridgeStatus(
  status: IranianBridgeStatus,
  now = Date.now()
): string[] {
  if (status.state === "not-required") return [];
  if (status.state === "loading") return ["Iranian rate", "Loading…"];
  if (status.state === "unavailable") return ["Iranian rate unavailable"];
  if (status.state === "misconfigured") {
    return ["Iranian rate configuration unavailable"];
  }
  if (status.state === "stale") {
    return [
      "Iranian rate",
      status.refreshError ? "Cached rate · Refresh failed" : "Cached rate",
    ];
  }

  const updatedTime = status.updatedAt ? Date.parse(status.updatedAt) : NaN;
  return [
    "Iranian rate",
    `Ehinium · ${
      Number.isFinite(updatedTime)
        ? formatUpdatedAt(updatedTime, now)
        : "Updated time unavailable"
    }`,
  ];
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
