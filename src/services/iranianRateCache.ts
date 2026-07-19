import type { IranianBridgeRate } from "../types/rates";

export const IRANIAN_BRIDGE_CACHE_STORAGE_KEY =
  "euc-iranian-bridge-cache-v1";
export const IRANIAN_BRIDGE_CACHE_TTL_MS = 30 * 60 * 1000;

export type IranianBridgeCacheSnapshot = {
  rate: IranianBridgeRate;
  fetchedAt: number;
  expiresAt: number;
};

export type IranianBridgeCacheResult = {
  rate: IranianBridgeRate;
  freshness: "fresh" | "stale";
  source: "memory" | "storage" | "network";
  refreshError?: string;
};

export type GetIranianBridgeRateOptions = {
  fetchRate: () => Promise<IranianBridgeRate>;
  now?: () => number;
  forceRefresh?: boolean;
};

type CachedCandidate = {
  snapshot: IranianBridgeCacheSnapshot;
  source: "memory" | "storage";
};

const REFRESH_ERROR_MESSAGE = "Ehinium Iranian bridge refresh failed";

let memorySnapshot: IranianBridgeCacheSnapshot | null = null;
let inFlightRequest: Promise<IranianBridgeCacheResult> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidRate(value: unknown): value is IranianBridgeRate {
  if (!isRecord(value)) return false;

  return (
    value.provider === "ehinium" &&
    value.unit === "IRT" &&
    typeof value.usdSellIrt === "number" &&
    Number.isFinite(value.usdSellIrt) &&
    value.usdSellIrt > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0 &&
    (value.sourceUpdatedAt === null ||
      typeof value.sourceUpdatedAt === "string")
  );
}

function isValidSnapshot(value: unknown): value is IranianBridgeCacheSnapshot {
  if (!isRecord(value)) return false;

  return (
    isValidRate(value.rate) &&
    isFiniteTimestamp(value.fetchedAt) &&
    isFiniteTimestamp(value.expiresAt) &&
    value.expiresAt >= value.fetchedAt
  );
}

function getLocalStorage(): chrome.storage.StorageArea | null {
  return typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : null;
}

async function removeInvalidPersistentSnapshot(
  storage: chrome.storage.StorageArea
): Promise<void> {
  try {
    await storage.remove(IRANIAN_BRIDGE_CACHE_STORAGE_KEY);
  } catch {
    // Invalid persistent data can be ignored when cleanup is unavailable.
  }
}

async function readPersistentSnapshot(): Promise<IranianBridgeCacheSnapshot | null> {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const stored = await storage.get(IRANIAN_BRIDGE_CACHE_STORAGE_KEY);
    const value = stored[IRANIAN_BRIDGE_CACHE_STORAGE_KEY];

    if (value === undefined) return null;
    if (isValidSnapshot(value)) return value;

    await removeInvalidPersistentSnapshot(storage);
    return null;
  } catch {
    return null;
  }
}

async function persistSnapshot(
  snapshot: IranianBridgeCacheSnapshot
): Promise<void> {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    await storage.set({
      [IRANIAN_BRIDGE_CACHE_STORAGE_KEY]: snapshot,
    });
  } catch {
    // A successful network refresh remains usable in memory.
  }
}

function newerCandidate(
  current: CachedCandidate | null,
  candidate: CachedCandidate
): CachedCandidate {
  return !current ||
    candidate.snapshot.fetchedAt > current.snapshot.fetchedAt
    ? candidate
    : current;
}

async function resolveIranianBridgeRate(
  options: GetIranianBridgeRateOptions,
  currentTime: number
): Promise<IranianBridgeCacheResult> {
  let fallback: CachedCandidate | null = memorySnapshot
    ? { snapshot: memorySnapshot, source: "memory" }
    : null;
  const persistentSnapshot = await readPersistentSnapshot();

  if (persistentSnapshot) {
    const persistentCandidate: CachedCandidate = {
      snapshot: persistentSnapshot,
      source: "storage",
    };
    fallback = newerCandidate(fallback, persistentCandidate);

    if (
      !memorySnapshot ||
      persistentSnapshot.fetchedAt > memorySnapshot.fetchedAt
    ) {
      memorySnapshot = persistentSnapshot;
    }

    if (!options.forceRefresh && persistentSnapshot.expiresAt > currentTime) {
      return {
        rate: persistentSnapshot.rate,
        freshness: "fresh",
        source: "storage",
      };
    }
  }

  try {
    const rate = await options.fetchRate();

    if (!isValidRate(rate)) {
      throw new Error(REFRESH_ERROR_MESSAGE);
    }

    const fetchedAt = options.now?.() ?? Date.now();
    const snapshot: IranianBridgeCacheSnapshot = {
      rate,
      fetchedAt,
      expiresAt: fetchedAt + IRANIAN_BRIDGE_CACHE_TTL_MS,
    };

    memorySnapshot = snapshot;
    await persistSnapshot(snapshot);

    return {
      rate,
      freshness: "fresh",
      source: "network",
    };
  } catch {
    if (fallback) {
      return {
        rate: fallback.snapshot.rate,
        freshness: "stale",
        source: fallback.source,
        refreshError: REFRESH_ERROR_MESSAGE,
      };
    }

    throw new Error(REFRESH_ERROR_MESSAGE);
  }
}

export async function getIranianBridgeRate(
  options: GetIranianBridgeRateOptions
): Promise<IranianBridgeCacheResult> {
  if (inFlightRequest) return inFlightRequest;

  const currentTime = options.now?.() ?? Date.now();

  if (
    !options.forceRefresh &&
    memorySnapshot &&
    memorySnapshot.expiresAt > currentTime
  ) {
    return {
      rate: memorySnapshot.rate,
      freshness: "fresh",
      source: "memory",
    };
  }

  const request = resolveIranianBridgeRate(options, currentTime);
  inFlightRequest = request;

  try {
    return await request;
  } finally {
    if (inFlightRequest === request) {
      inFlightRequest = null;
    }
  }
}
