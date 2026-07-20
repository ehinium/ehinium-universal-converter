import type { IranianBridgeRate } from "../types/rates";
import {
  IranianBridgeClientError,
  requestIranianBridgeRate,
  requestIranianBridgeRateDetails,
} from "./iranianBridgeClient";

const rate: IranianBridgeRate = {
  unit: "IRT",
  usdSellIrt: 200000,
  updatedAt: "2026-01-01T00:00:00Z",
  sourceUpdatedAt: null,
  provider: "ehinium",
};

function successResponse(rateValue: unknown = rate): unknown {
  return {
    ok: true,
    rate: rateValue,
    freshness: "fresh",
    source: "network",
  };
}

function asSendMessage(
  implementation: (message: unknown) => Promise<unknown>
): typeof chrome.runtime.sendMessage {
  return implementation as typeof chrome.runtime.sendMessage;
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

async function expectUnavailable(
  action: () => Promise<unknown>,
  description: string,
  forbiddenText?: string
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expectEqual(message, "Iranian rates are unavailable", description);

    if (forbiddenText && message.includes(forbiddenText)) {
      throw new Error(`${description}: exposed sensitive error text`);
    }

    return;
  }

  throw new Error(`${description}: expected rejection`);
}

let capturedMessages: unknown[] = [];
const returnedRate = await requestIranianBridgeRate({
  sendMessage: asSendMessage(async (message) => {
    capturedMessages.push(message);
    return successResponse();
  }),
});
expectEqual(
  JSON.stringify(returnedRate),
  JSON.stringify(rate),
  "successful response returns only its normalized rate"
);
expectEqual(
  JSON.stringify(capturedMessages),
  JSON.stringify([{ type: "GET_IRANIAN_BRIDGE_RATE" }]),
  "request omits an unspecified forceRefresh"
);

capturedMessages = [];
await requestIranianBridgeRate({
  forceRefresh: true,
  sendMessage: asSendMessage(async (message) => {
    capturedMessages.push(message);
    return successResponse();
  }),
});
expectEqual(
  JSON.stringify(capturedMessages),
  JSON.stringify([
    { type: "GET_IRANIAN_BRIDGE_RATE", forceRefresh: true },
  ]),
  "forceRefresh true is passed through"
);

const previousChromeDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "chrome"
);
let runtimeCalls = 0;
Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    runtime: {
      sendMessage: async (message: unknown) => {
        runtimeCalls += 1;
        expectEqual(
          JSON.stringify(message),
          JSON.stringify({ type: "GET_IRANIAN_BRIDGE_RATE" }),
          "runtime fallback request"
        );
        return successResponse();
      },
    },
  },
});
try {
  expectEqual(
    JSON.stringify(await requestIranianBridgeRate()),
    JSON.stringify(rate),
    "chrome runtime fallback returns the rate"
  );
  expectEqual(runtimeCalls, 1, "chrome runtime fallback call count");

  let injectedCalls = 0;
  await requestIranianBridgeRate({
    sendMessage: asSendMessage(async () => {
      injectedCalls += 1;
      return successResponse();
    }),
  });
  expectEqual(injectedCalls, 1, "injected sender call count");
  expectEqual(runtimeCalls, 1, "injected sender bypasses chrome runtime");
} finally {
  if (previousChromeDescriptor) {
    Object.defineProperty(globalThis, "chrome", previousChromeDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "chrome");
  }
}

for (const [description, response] of [
  ["typed failure response", { ok: false, error: "unavailable" }],
  ["missing response", undefined],
  ["missing rate", { ok: true, freshness: "fresh", source: "network" }],
  ["malformed success envelope", { ok: true, rate }],
  ["wrong unit", successResponse({ ...rate, unit: "IRR" })],
  ["wrong provider", successResponse({ ...rate, provider: "other" })],
  ["zero sell", successResponse({ ...rate, usdSellIrt: 0 })],
  ["negative sell", successResponse({ ...rate, usdSellIrt: -1 })],
  ["NaN sell", successResponse({ ...rate, usdSellIrt: Number.NaN })],
  ["infinite sell", successResponse({ ...rate, usdSellIrt: Infinity })],
  ["empty updatedAt", successResponse({ ...rate, updatedAt: " " })],
  [
    "invalid sourceUpdatedAt",
    successResponse({ ...rate, sourceUpdatedAt: "" }),
  ],
] as const) {
  await expectUnavailable(
    () =>
      requestIranianBridgeRate({
        sendMessage: asSendMessage(async () => response),
      }),
    description
  );
}

await expectUnavailable(
  () =>
    requestIranianBridgeRate({
      sendMessage: asSendMessage(async () => {
        throw new Error("Bearer fake-sensitive-token");
      }),
    }),
  "sendMessage rejection is sanitized",
  "fake-sensitive-token"
);

const chromeBeforeMissingTest = Object.getOwnPropertyDescriptor(
  globalThis,
  "chrome"
);
Reflect.deleteProperty(globalThis, "chrome");
try {
  await expectUnavailable(
    () => requestIranianBridgeRate(),
    "missing chrome is sanitized"
  );
} finally {
  if (chromeBeforeMissingTest) {
    Object.defineProperty(globalThis, "chrome", chromeBeforeMissingTest);
  }
}

const immutableRate = Object.freeze({ ...rate });
const immutableResponse = Object.freeze({
  ok: true as const,
  rate: immutableRate,
  freshness: "stale" as const,
  source: "storage" as const,
  refreshError: "refresh unavailable",
});
const responseBefore = JSON.stringify(immutableResponse);
let immutableMessage: unknown;

await requestIranianBridgeRate({
  forceRefresh: true,
  sendMessage: asSendMessage(async (message) => {
    immutableMessage = Object.freeze(message as object);
    return immutableResponse;
  }),
});

expectEqual(
  JSON.stringify(immutableResponse),
  responseBefore,
  "response is not mutated"
);
expectEqual(
  JSON.stringify(immutableMessage),
  JSON.stringify({ type: "GET_IRANIAN_BRIDGE_RATE", forceRefresh: true }),
  "request message is not mutated"
);

for (const source of ["network", "memory", "storage"] as const) {
  const details = await requestIranianBridgeRateDetails({
    sendMessage: asSendMessage(async () => ({
      ok: true,
      rate,
      freshness: "fresh",
      source,
    })),
  });
  expectEqual(
    JSON.stringify(details.rate),
    JSON.stringify(rate),
    `detailed ${source} rate`
  );
  expectEqual(details.freshness, "fresh", `detailed ${source} freshness`);
  expectEqual(details.source, source, `detailed ${source} source`);
}

const staleDetails = await requestIranianBridgeRateDetails({
  sendMessage: asSendMessage(async () => ({
    ok: true,
    rate: { ...rate, authorization: "Bearer secret-token" },
    freshness: "stale",
    source: "storage",
    refreshError: "Bearer secret-token",
  })),
});
expectEqual(staleDetails.freshness, "stale", "stale detailed freshness");
expectEqual(
  staleDetails.refreshError,
  "Iranian rates refresh failed",
  "stale refresh error is sanitized"
);
expectEqual(
  JSON.stringify(staleDetails).includes("secret-token"),
  false,
  "detailed result excludes sensitive text"
);

capturedMessages = [];
await requestIranianBridgeRateDetails({
  forceRefresh: true,
  sendMessage: asSendMessage(async (message) => {
    capturedMessages.push(message);
    return successResponse();
  }),
});
expectEqual(
  JSON.stringify(capturedMessages[0]),
  JSON.stringify({ type: "GET_IRANIAN_BRIDGE_RATE", forceRefresh: true }),
  "detailed force refresh message"
);

async function expectDetailedError(
  action: () => Promise<unknown>,
  code: "misconfigured" | "unavailable",
  description: string
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof IranianBridgeClientError)) {
      throw new Error(`${description}: expected IranianBridgeClientError`);
    }
    expectEqual(error.code, code, description);
    expectEqual(error.message.includes("secret-token"), false, description);
    return;
  }
  throw new Error(`${description}: expected rejection`);
}

await expectDetailedError(
  () =>
    requestIranianBridgeRateDetails({
      sendMessage: asSendMessage(async () => ({
        ok: false,
        error: "Bearer secret-token",
      })),
    }),
  "unavailable",
  "detailed failure response"
);
await expectDetailedError(
  () =>
    requestIranianBridgeRateDetails({
      sendMessage: asSendMessage(async () => ({ ok: true, rate })),
    }),
  "unavailable",
  "detailed malformed response"
);
await expectDetailedError(
  () =>
    requestIranianBridgeRateDetails({
      sendMessage: asSendMessage(async () => ({
        ok: false,
        error: "Iranian rates configuration is missing",
      })),
    }),
  "misconfigured",
  "background configuration failure"
);

const chromeBeforeDetailedMissing = Object.getOwnPropertyDescriptor(
  globalThis,
  "chrome"
);
Reflect.deleteProperty(globalThis, "chrome");
try {
  await expectDetailedError(
    () => requestIranianBridgeRateDetails(),
    "misconfigured",
    "missing runtime category"
  );
} finally {
  if (chromeBeforeDetailedMissing) {
    Object.defineProperty(globalThis, "chrome", chromeBeforeDetailedMissing);
  }
}
