import type { FetchEhiniumIranianRateOptions } from "../services/ehiniumIranianRates";
import type {
  GetIranianBridgeRateOptions,
  IranianBridgeCacheResult,
} from "../services/iranianRateCache";
import type { GetIranianBridgeRateResponse } from "../shared/messages";
import type { IranianBridgeRate } from "../types/rates";
import { createIranianBridgeMessageHandler } from "./iranianBridgeHandler";

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

const rate: IranianBridgeRate = {
  unit: "IRT",
  usdSellIrt: 200_000,
  updatedAt: "2026-07-19T12:00:00Z",
  sourceUpdatedAt: "2026-07-19T11:00:00Z",
  provider: "ehinium",
};
const apiUrl = "https://ehinium-rates-api.ehinium.workers.dev";
const token = "internal-extension-token";
const fetchImpl: typeof fetch = async () => {
  throw new Error("injected fetch should only be forwarded");
};

function responseContainsToken(
  response: GetIranianBridgeRateResponse | undefined
): boolean {
  return JSON.stringify(response).includes(token);
}

{
  let cacheCalls = 0;
  let providerCalls = 0;
  const handler = createIranianBridgeMessageHandler({
    apiUrl: "",
    token: "",
    dependencies: {
      getIranianBridgeRate: async () => {
        cacheCalls += 1;
        throw new Error("cache must not run");
      },
      fetchEhiniumIranianRate: async () => {
        providerCalls += 1;
        throw new Error("provider must not run");
      },
    },
  });
  expectEqual(await handler({ type: "PING" }), undefined, "unrelated message ignored");
  expectEqual(await handler(null), undefined, "non-object message ignored");
  expectEqual(cacheCalls, 0, "unrelated message skips cache");
  expectEqual(providerCalls, 0, "unrelated message skips provider");
}

{
  let cacheCalls = 0;
  let providerCalls = 0;
  const received: {
    cacheOptions?: GetIranianBridgeRateOptions;
    providerOptions?: FetchEhiniumIranianRateOptions;
  } = {};
  const handler = createIranianBridgeMessageHandler({
    apiUrl,
    token,
    fetchImpl,
    dependencies: {
      async fetchEhiniumIranianRate(options) {
        providerCalls += 1;
        received.providerOptions = options;
        return rate;
      },
      async getIranianBridgeRate(options) {
        cacheCalls += 1;
        received.cacheOptions = options;
        return {
          rate: await options.fetchRate(),
          freshness: "fresh",
          source: "network",
        };
      },
    },
  });
  const message = { type: "GET_IRANIAN_BRIDGE_RATE", forceRefresh: true } as const;
  const messageBefore = { ...message };
  const response = await handler(message);

  expectEqual(
    response,
    { ok: true, rate, freshness: "fresh", source: "network" },
    "fresh network response"
  );
  expectEqual(cacheCalls, 1, "network response cache call count");
  expectEqual(providerCalls, 1, "network response provider call count");
  expectEqual(received.cacheOptions?.forceRefresh, true, "force refresh forwarded");
  expectEqual(received.providerOptions?.apiUrl, apiUrl, "API URL forwarded exactly");
  expectEqual(received.providerOptions?.token, token, "token forwarded internally exactly");
  expectEqual(received.providerOptions?.fetchImpl, fetchImpl, "fetch implementation forwarded");
  expect(!responseContainsToken(response), "successful response excludes token");
  expectEqual(message, messageBefore, "input message is not mutated");
}

for (const source of ["memory", "storage"] as const) {
  let cacheCalls = 0;
  let providerCalls = 0;
  const handler = createIranianBridgeMessageHandler({
    apiUrl,
    token,
    dependencies: {
      async getIranianBridgeRate() {
        cacheCalls += 1;
        return { rate, freshness: "fresh", source };
      },
      async fetchEhiniumIranianRate() {
        providerCalls += 1;
        throw new Error("fresh cache must not invoke provider");
      },
    },
  });
  const response = await handler({ type: "GET_IRANIAN_BRIDGE_RATE" });
  expectEqual(
    response,
    { ok: true, rate, freshness: "fresh", source },
    `fresh ${source} response`
  );
  expectEqual(cacheCalls, 1, `fresh ${source} cache call count`);
  expectEqual(providerCalls, 0, `fresh ${source} skips provider`);
  expect(!responseContainsToken(response), `fresh ${source} response excludes token`);
}

{
  const staleResult: IranianBridgeCacheResult = {
    rate,
    freshness: "stale",
    source: "storage",
    refreshError: "Ehinium Iranian bridge refresh failed",
  };
  const handler = createIranianBridgeMessageHandler({
    apiUrl,
    token,
    dependencies: {
      getIranianBridgeRate: async () => staleResult,
      fetchEhiniumIranianRate: async () => {
        throw new Error("stale cache owns provider behavior");
      },
    },
  });
  const response = await handler({ type: "GET_IRANIAN_BRIDGE_RATE" });
  expectEqual(
    response,
    { ok: true, ...staleResult },
    "stale fallback preserves sanitized refresh error"
  );
  expect(!responseContainsToken(response), "stale response excludes token");
}

for (const [missingOptions, description] of [
  [{ apiUrl: "", token }, "missing URL"],
  [{ apiUrl, token: "  " }, "missing token"],
] as const) {
  let cacheCalls = 0;
  let providerCalls = 0;
  const handler = createIranianBridgeMessageHandler({
    ...missingOptions,
    dependencies: {
      getIranianBridgeRate: async () => {
        cacheCalls += 1;
        throw new Error("cache must not run");
      },
      fetchEhiniumIranianRate: async () => {
        providerCalls += 1;
        throw new Error("provider must not run");
      },
    },
  });
  const response = await handler({ type: "GET_IRANIAN_BRIDGE_RATE" });
  expectEqual(
    response,
    { ok: false, error: "Iranian rates configuration is missing" },
    description
  );
  expectEqual(cacheCalls, 0, `${description} skips cache`);
  expectEqual(providerCalls, 0, `${description} skips provider`);
}

{
  let cacheCalls = 0;
  let providerCalls = 0;
  const handler = createIranianBridgeMessageHandler({
    apiUrl,
    token,
    dependencies: {
      async getIranianBridgeRate(options) {
        cacheCalls += 1;
        await options.fetchRate();
        throw new Error("unreachable");
      },
      async fetchEhiniumIranianRate() {
        providerCalls += 1;
        throw new Error(`provider exposed Bearer ${token}`);
      },
    },
  });
  const response = await handler({ type: "GET_IRANIAN_BRIDGE_RATE" });
  expectEqual(
    response,
    { ok: false, error: "Iranian rates are unavailable" },
    "provider failure is sanitized"
  );
  expectEqual(cacheCalls, 1, "provider failure cache call count");
  expectEqual(providerCalls, 1, "provider failure provider call count");
  expect(!responseContainsToken(response), "provider failure excludes token");
}

{
  let cacheCalls = 0;
  let providerCalls = 0;
  const handler = createIranianBridgeMessageHandler({
    apiUrl,
    token,
    dependencies: {
      async getIranianBridgeRate() {
        cacheCalls += 1;
        throw new Error(`cache exposed ${token}`);
      },
      async fetchEhiniumIranianRate() {
        providerCalls += 1;
        return rate;
      },
    },
  });
  const response = await handler({ type: "GET_IRANIAN_BRIDGE_RATE" });
  expectEqual(
    response,
    { ok: false, error: "Iranian rates are unavailable" },
    "cache failure is sanitized"
  );
  expectEqual(cacheCalls, 1, "cache failure call count");
  expectEqual(providerCalls, 0, "cache failure does not directly call provider");
  expect(!responseContainsToken(response), "cache failure excludes token");
}

type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean | undefined;

type ContextMenuClickListener = (
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
) => void;

{
  const originalChromeDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "chrome"
  );
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "fetch"
  );
  const apiUrlDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__EUC_IRANIAN_RATES_API_URL__"
  );
  const tokenDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__EUC_IRANIAN_RATES_TOKEN__"
  );
  const captured: {
    runtimeMessageListener?: RuntimeMessageListener;
    installedListener?: () => void;
    startupListener?: () => void;
    contextMenuClickListener?: ContextMenuClickListener;
  } = {};
  const createdMenus: chrome.contextMenus.CreateProperties[] = [];
  let fetchCalls = 0;

  Object.defineProperty(globalThis, "__EUC_IRANIAN_RATES_API_URL__", {
    configurable: true,
    value: "https://ehinium-rates-api.ehinium.workers.dev/v1/rates",
  });
  Object.defineProperty(globalThis, "__EUC_IRANIAN_RATES_TOKEN__", {
    configurable: true,
    value: "",
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      fetchCalls += 1;
      throw new Error("production background test must not fetch");
    },
  });
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined,
          remove: async () => undefined,
        },
        sync: {
          get: async () => ({}),
          set: async () => undefined,
        },
        onChanged: {
          addListener: () => undefined,
          removeListener: () => undefined,
        },
      },
      runtime: {
        onInstalled: {
          addListener(listener: () => void) {
            captured.installedListener = listener;
          },
        },
        onStartup: {
          addListener(listener: () => void) {
            captured.startupListener = listener;
          },
        },
        onMessage: {
          addListener(listener: RuntimeMessageListener) {
            captured.runtimeMessageListener = listener;
          },
        },
      },
      contextMenus: {
        removeAll(callback: () => void) {
          callback();
        },
        create(properties: chrome.contextMenus.CreateProperties) {
          createdMenus.push(properties);
        },
        onClicked: {
          addListener(listener: ContextMenuClickListener) {
            captured.contextMenuClickListener = listener;
          },
        },
      },
      tabs: {
        sendMessage: async () => undefined,
      },
    },
  });

  try {
    await import("./index");

    expectEqual(fetchCalls, 0, "background startup performs no Iranian request");
    expect(
      typeof captured.runtimeMessageListener === "function",
      "background runtime listener is registered"
    );
    expect(
      typeof captured.contextMenuClickListener === "function",
      "existing context-menu click listener remains registered"
    );
    expect(
      typeof captured.installedListener === "function" &&
        typeof captured.startupListener === "function",
      "existing context-menu lifecycle listeners remain registered"
    );

    captured.installedListener?.();
    expectEqual(createdMenus.length, 1, "existing context menu is created once");
    expectEqual(
      createdMenus[0],
      {
        id: "ehinium-convert-selection",
        title: "Convert with Ehinium Universal Converter",
        contexts: ["selection"],
      },
      "existing context-menu configuration is unchanged"
    );

    const listener = captured.runtimeMessageListener;
    expect(listener, "runtime message listener is available");

    const pingResponses: unknown[] = [];
    const pingReturn = listener({ type: "PING" }, {}, (response) => {
      pingResponses.push(response);
    });
    expectEqual(pingReturn, false, "PING keeps its synchronous listener result");
    expectEqual(pingResponses, [{ ok: true }], "PING response is unchanged");

    const unrelatedResponses: unknown[] = [];
    const unrelatedReturn = listener(
      { type: "UNRELATED" },
      {},
      (response) => unrelatedResponses.push(response)
    );
    expectEqual(unrelatedReturn, false, "unrelated message is not consumed");
    expectEqual(unrelatedResponses, [], "unrelated message receives no response");

    const selectedTextResponses: unknown[] = [];
    const selectedTextReturn = listener(
      { type: "SHOW_MANUAL_CONVERSION", formatted: "$1.00" },
      {},
      (response) => selectedTextResponses.push(response)
    );
    expectEqual(
      selectedTextReturn,
      false,
      "existing selected-text message handling remains synchronous"
    );
    expectEqual(
      selectedTextResponses,
      [],
      "existing selected-text message response behavior is unchanged"
    );

    let iranianResponseCount = 0;
    let resolveIranianResponse: (response: unknown) => void = () => undefined;
    const iranianResponsePromise = new Promise<unknown>((resolve) => {
      resolveIranianResponse = resolve;
    });
    const iranianReturn = listener(
      { type: "GET_IRANIAN_BRIDGE_RATE", forceRefresh: true },
      {},
      (response) => {
        iranianResponseCount += 1;
        resolveIranianResponse(response);
      }
    );
    expectEqual(iranianReturn, true, "Iranian request keeps async channel open");
    const iranianResponse = await iranianResponsePromise;
    await Promise.resolve();
    expectEqual(iranianResponseCount, 1, "Iranian response is sent exactly once");
    expectEqual(
      iranianResponse,
      { ok: false, error: "Iranian rates configuration is missing" },
      "missing token returns typed Iranian failure"
    );
    expectEqual(fetchCalls, 0, "missing token performs no request");

    const finalPingResponses: unknown[] = [];
    expectEqual(
      listener({ type: "PING" }, {}, (response) => {
        finalPingResponses.push(response);
      }),
      false,
      "missing Iranian token does not alter unrelated messages"
    );
    expectEqual(finalPingResponses, [{ ok: true }], "PING still works after Iranian failure");
  } finally {
    for (const [name, descriptor] of [
      ["chrome", originalChromeDescriptor],
      ["fetch", originalFetchDescriptor],
      ["__EUC_IRANIAN_RATES_API_URL__", apiUrlDescriptor],
      ["__EUC_IRANIAN_RATES_TOKEN__", tokenDescriptor],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
  }
}
