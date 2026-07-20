import type { IranianBridgeRate } from "../types/rates";
import {
  getIranianBridgeRate,
  IRANIAN_BRIDGE_CACHE_STORAGE_KEY,
  IRANIAN_BRIDGE_CACHE_TTL_MS,
  type IranianBridgeCacheSnapshot,
} from "./iranianRateCache";

function expect(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

async function expectRejects(
  action: () => Promise<unknown>,
  expectedMessage: string,
  description: string,
  forbiddenText?: string
): Promise<void> {
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(caught instanceof Error, `${description}: expected an Error`);
  expectEqual(caught.message, expectedMessage, description);
  if (forbiddenText) {
    expect(
      !caught.message.includes(forbiddenText),
      `${description}: exposed forbidden text`
    );
  }
}

function rate(value: number, suffix: string): IranianBridgeRate {
  return {
    unit: "IRT",
    usdSellIrt: value,
    updatedAt: `2026-07-19T${suffix}:00Z`,
    sourceUpdatedAt: null,
    provider: "ehinium",
  };
}

function snapshot(
  cachedRate: IranianBridgeRate,
  fetchedAt: number,
  expiresAt: number
): IranianBridgeCacheSnapshot {
  return { rate: cachedRate, fetchedAt, expiresAt };
}

function invalidSnapshot(
  cachedRate: unknown,
  fetchedAt: number,
  expiresAt: number
): unknown {
  return { rate: cachedRate, fetchedAt, expiresAt };
}

const originalChrome = globalThis.chrome;
const stored = new Map<string, unknown>();
let readFailure = false;
let writeFailure = false;
let removeCount = 0;

const localStorage = {
  async get(key: string) {
    if (readFailure) throw new Error("storage read included Bearer private-token");
    return { [key]: stored.get(key) };
  },
  async set(values: Record<string, unknown>) {
    if (writeFailure) throw new Error("storage write failed");
    for (const [key, value] of Object.entries(values)) stored.set(key, value);
  },
  async remove(key: string) {
    removeCount += 1;
    stored.delete(key);
  },
};

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: { storage: { local: localStorage } },
});

let now = 1_000;
const clock = () => now;
const refreshFailure = "Ehinium Iranian bridge refresh failed";
const secretToken = "private-token";

try {
  let failedFetchCalls = 0;
  let rejectFirstFetch: (reason: Error) => void = () => undefined;
  const firstFailure = new Promise<IranianBridgeRate>((_resolve, reject) => {
    rejectFirstFetch = reject;
  });
  const failingFetch = () => {
    failedFetchCalls += 1;
    return firstFailure;
  };
  const firstFailureRequest = getIranianBridgeRate({
    fetchRate: failingFetch,
    now: clock,
  });
  const sharedFailureRequest = getIranianBridgeRate({
    fetchRate: failingFetch,
    now: clock,
  });
  rejectFirstFetch(new Error(`Bearer ${secretToken}`));
  await expectRejects(
    () => firstFailureRequest,
    refreshFailure,
    "no cache plus network failure",
    secretToken
  );
  await expectRejects(
    () => sharedFailureRequest,
    refreshFailure,
    "simultaneous failed caller",
    secretToken
  );
  expectEqual(failedFetchCalls, 1, "simultaneous failed callers share one fetch");

  const networkRate = rate(193_500, "10:00");
  let networkCalls = 0;
  const networkResult = await getIranianBridgeRate({
    fetchRate: async () => {
      networkCalls += 1;
      return networkRate;
    },
    now: clock,
  });
  expectEqual(networkResult.source, "network", "network fetch on empty cache");
  expectEqual(networkResult.freshness, "fresh", "network result freshness");
  expectEqual(networkCalls, 1, "failed in-flight refresh is cleared for retry");
  const persistedNetworkSnapshot = stored.get(IRANIAN_BRIDGE_CACHE_STORAGE_KEY);
  expectEqual(
    persistedNetworkSnapshot,
    snapshot(networkRate, now, now + IRANIAN_BRIDGE_CACHE_TTL_MS),
    "network result persisted"
  );
  const persistedText = JSON.stringify(persistedNetworkSnapshot);
  expect(!persistedText.includes(secretToken), "persistent cache excludes token");
  expect(!persistedText.includes("Bearer"), "persistent cache excludes authorization data");

  const memoryResult = await getIranianBridgeRate({
    fetchRate: async () => {
      throw new Error("fresh memory must not fetch");
    },
    now: clock,
  });
  expectEqual(memoryResult.source, "memory", "fresh memory hit");
  expectEqual(memoryResult.rate, networkRate, "fresh memory rate");

  now += IRANIAN_BRIDGE_CACHE_TTL_MS + 1;
  const storageRate = rate(194_000, "11:00");
  stored.set(
    IRANIAN_BRIDGE_CACHE_STORAGE_KEY,
    snapshot(storageRate, now - 10, now + 10_000)
  );
  const storageResult = await getIranianBridgeRate({
    fetchRate: async () => {
      throw new Error("fresh storage must not fetch");
    },
    now: clock,
  });
  expectEqual(storageResult.source, "storage", "fresh persistent storage hit");
  expectEqual(storageResult.rate, storageRate, "fresh persistent rate");

  now += 10_001;
  stored.delete(IRANIAN_BRIDGE_CACHE_STORAGE_KEY);
  const refreshedMemoryRate = rate(195_000, "12:00");
  const expiredMemoryRefresh = await getIranianBridgeRate({
    fetchRate: async () => refreshedMemoryRate,
    now: clock,
  });
  expectEqual(expiredMemoryRefresh.source, "network", "expired memory triggers refresh");

  now += IRANIAN_BRIDGE_CACHE_TTL_MS + 1;
  const expiredStorageRate = rate(196_000, "13:00");
  stored.set(
    IRANIAN_BRIDGE_CACHE_STORAGE_KEY,
    snapshot(expiredStorageRate, now - 20, now - 1)
  );
  const refreshedStorageRate = rate(197_000, "14:00");
  const expiredStorageRefresh = await getIranianBridgeRate({
    fetchRate: async () => refreshedStorageRate,
    now: clock,
  });
  expectEqual(expiredStorageRefresh.source, "network", "expired storage triggers refresh");

  now += IRANIAN_BRIDGE_CACHE_TTL_MS + 1;
  stored.delete(IRANIAN_BRIDGE_CACHE_STORAGE_KEY);
  const staleMemoryResult = await getIranianBridgeRate({
    fetchRate: async () => {
      throw new Error(`Bearer ${secretToken}`);
    },
    now: clock,
  });
  expectEqual(staleMemoryResult.source, "memory", "stale memory fallback source");
  expectEqual(staleMemoryResult.freshness, "stale", "stale memory freshness");
  expectEqual(staleMemoryResult.refreshError, refreshFailure, "sanitized stale memory error");
  expect(
    !staleMemoryResult.refreshError?.includes(secretToken),
    "stale memory error excludes token"
  );

  const newerStorageRate = rate(198_000, "15:00");
  stored.set(
    IRANIAN_BRIDGE_CACHE_STORAGE_KEY,
    snapshot(newerStorageRate, now + 10, now + 10)
  );
  now += 20;
  const staleStorageResult = await getIranianBridgeRate({
    fetchRate: async () => {
      throw new Error("temporary failure");
    },
    now: clock,
  });
  expectEqual(staleStorageResult.source, "storage", "stale storage fallback source");
  expectEqual(staleStorageResult.rate, newerStorageRate, "newest stale snapshot selected");
  expectEqual(staleStorageResult.freshness, "stale", "stale storage freshness");

  const forceMemoryRate = rate(199_000, "16:00");
  const forceMemoryResult = await getIranianBridgeRate({
    fetchRate: async () => forceMemoryRate,
    now: clock,
    forceRefresh: true,
  });
  expectEqual(forceMemoryResult.source, "network", "force refresh bypasses fresh memory");

  now += IRANIAN_BRIDGE_CACHE_TTL_MS + 1;
  const freshForceStorageRate = rate(200_000, "17:00");
  stored.set(
    IRANIAN_BRIDGE_CACHE_STORAGE_KEY,
    snapshot(freshForceStorageRate, now - 1, now + 10_000)
  );
  const forcedNetworkRate = rate(201_000, "18:00");
  const forceStorageResult = await getIranianBridgeRate({
    fetchRate: async () => forcedNetworkRate,
    now: clock,
    forceRefresh: true,
  });
  expectEqual(forceStorageResult.source, "network", "force refresh bypasses fresh storage");

  const forceFallbackResult = await getIranianBridgeRate({
    fetchRate: async () => {
      throw new Error("forced refresh failed");
    },
    now: clock,
    forceRefresh: true,
  });
  expectEqual(forceFallbackResult.freshness, "stale", "force failure returns cached data as stale");
  expectEqual(forceFallbackResult.rate, forcedNetworkRate, "force failure cached fallback");

  const invalidSnapshots: Array<[string, unknown]> = [
    ["malformed snapshot", "not-an-object"],
    ["invalid provider", invalidSnapshot({ ...networkRate, provider: "other" }, 1, 2)],
    ["invalid unit", invalidSnapshot({ ...networkRate, unit: "IRR" }, 1, 2)],
    ["zero rate", snapshot({ ...networkRate, usdSellIrt: 0 }, 1, 2)],
    ["negative rate", snapshot({ ...networkRate, usdSellIrt: -1 }, 1, 2)],
    ["NaN rate", snapshot({ ...networkRate, usdSellIrt: Number.NaN }, 1, 2)],
    ["infinite rate", snapshot({ ...networkRate, usdSellIrt: Number.POSITIVE_INFINITY }, 1, 2)],
    ["empty updatedAt", snapshot({ ...networkRate, updatedAt: " " }, 1, 2)],
    ["invalid sourceUpdatedAt", invalidSnapshot({ ...networkRate, sourceUpdatedAt: 42 }, 1, 2)],
    ["invalid fetchedAt", snapshot(networkRate, Number.NaN, 2)],
    ["invalid expiresAt", snapshot(networkRate, 1, Number.POSITIVE_INFINITY)],
    ["expiration before fetch", snapshot(networkRate, 2, 1)],
  ];

  for (const [description, invalidSnapshot] of invalidSnapshots) {
    now += IRANIAN_BRIDGE_CACHE_TTL_MS + 1;
    stored.set(IRANIAN_BRIDGE_CACHE_STORAGE_KEY, invalidSnapshot);
    const replacementRate = rate(202_000 + removeCount, "19:00");
    const invalidResult = await getIranianBridgeRate({
      fetchRate: async () => replacementRate,
      now: clock,
      forceRefresh: true,
    });
    expectEqual(invalidResult.source, "network", `${description} is ignored`);
    expect(
      stored.get(IRANIAN_BRIDGE_CACHE_STORAGE_KEY) !== invalidSnapshot,
      `${description} is removed or replaced`
    );
  }
  expect(removeCount >= invalidSnapshots.length, "invalid storage snapshots are removed");

  now += IRANIAN_BRIDGE_CACHE_TTL_MS + 1;
  readFailure = true;
  const readFailureRate = rate(203_000, "20:00");
  const readFailureResult = await getIranianBridgeRate({
    fetchRate: async () => readFailureRate,
    now: clock,
    forceRefresh: true,
  });
  readFailure = false;
  expectEqual(readFailureResult.rate, readFailureRate, "storage read failure permits network success");

  now += 1;
  writeFailure = true;
  const writeFailureRate = rate(204_000, "21:00");
  const writeFailureResult = await getIranianBridgeRate({
    fetchRate: async () => writeFailureRate,
    now: clock,
    forceRefresh: true,
  });
  writeFailure = false;
  expectEqual(writeFailureResult.rate, writeFailureRate, "storage write failure preserves network result");
  const postWriteFailureMemory = await getIranianBridgeRate({
    fetchRate: async () => {
      throw new Error("memory should remain available");
    },
    now: clock,
  });
  expectEqual(postWriteFailureMemory.source, "memory", "write failure keeps fresh memory");

  let simultaneousFetchCalls = 0;
  let resolveSimultaneousFetch: (value: IranianBridgeRate) => void = () => undefined;
  const simultaneousFetch = new Promise<IranianBridgeRate>((resolve) => {
    resolveSimultaneousFetch = resolve;
  });
  const sharedFetcher = () => {
    simultaneousFetchCalls += 1;
    return simultaneousFetch;
  };
  const firstCaller = getIranianBridgeRate({
    fetchRate: sharedFetcher,
    now: clock,
    forceRefresh: true,
  });
  const secondCaller = getIranianBridgeRate({
    fetchRate: sharedFetcher,
    now: clock,
    forceRefresh: true,
  });
  const simultaneousRate = rate(205_000, "22:00");
  resolveSimultaneousFetch(simultaneousRate);
  const [firstResult, secondResult] = await Promise.all([
    firstCaller,
    secondCaller,
  ]);
  expectEqual(simultaneousFetchCalls, 1, "simultaneous callers share one fetch");
  expectEqual(firstResult, secondResult, "simultaneous callers resolve consistently");
  expectEqual(firstResult.rate, simultaneousRate, "shared fetch result");
} finally {
  if (originalChrome === undefined) {
    Reflect.deleteProperty(globalThis, "chrome");
  } else {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: originalChrome,
    });
  }
}
