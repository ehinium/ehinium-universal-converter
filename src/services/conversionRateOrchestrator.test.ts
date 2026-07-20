import type {
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";
import { convertCurrency } from "../utils/currencyConverter";
import { getConversionRatesForPair } from "./conversionRateOrchestrator";

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

function expectClose(
  actual: number | null,
  expected: number,
  description: string
): void {
  expect(actual !== null, `${description}: expected a numeric result`);
  const tolerance = Math.max(1, Math.abs(expected)) * 1e-12;
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${description}: expected ${expected}, received ${actual}`);
  }
}

async function expectRejects(
  action: () => Promise<unknown>,
  expectedMessage: string,
  description: string
): Promise<void> {
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(caught instanceof Error, `${description}: expected an Error`);
  expectEqual(caught.message, expectedMessage, description);
}

const bridge: IranianBridgeRate = {
  unit: "IRT",
  usdSellIrt: 200_000,
  updatedAt: "2026-07-19T12:00:00Z",
  sourceUpdatedAt: "2026-07-19T11:00:00Z",
  provider: "ehinium",
};

const usdRates: NormalizedRatesResponse = {
  base: "USD",
  date: "2026-07-19",
  provider: "frankfurter",
  rates: { USD: 1, EUR: 0.8, GBP: 0.5 },
};
const eurRates: NormalizedRatesResponse = {
  base: "EUR",
  date: "2026-07-19",
  provider: "frankfurter",
  rates: { EUR: 1, USD: 1.25, GBP: 0.625 },
};
const gbpRates: NormalizedRatesResponse = {
  base: "GBP",
  date: "2026-07-19",
  provider: "fawaz",
  rates: { GBP: 1, USD: 2, EUR: 1.6 },
};

type Dependencies = {
  globalCalls: string[];
  bridgeCalls: number;
  getGlobalRates: (baseCurrency: string) => Promise<NormalizedRatesResponse>;
  getIranianBridge: () => Promise<IranianBridgeRate>;
};

function dependencies(options: {
  globalError?: Error;
  bridgeError?: Error;
  responseForBase?: (baseCurrency: string) => NormalizedRatesResponse;
  bridgeValue?: IranianBridgeRate;
} = {}): Dependencies {
  const result: Dependencies = {
    globalCalls: [],
    bridgeCalls: 0,
    async getGlobalRates(baseCurrency) {
      result.globalCalls.push(baseCurrency);
      if (options.globalError) throw options.globalError;
      if (options.responseForBase) return options.responseForBase(baseCurrency);
      if (baseCurrency === "USD") return usdRates;
      if (baseCurrency === "EUR") return eurRates;
      if (baseCurrency === "GBP") return gbpRates;
      throw new Error(`No fixture for ${baseCurrency}`);
    },
    async getIranianBridge() {
      result.bridgeCalls += 1;
      if (options.bridgeError) throw options.bridgeError;
      return options.bridgeValue ?? bridge;
    },
  };
  return result;
}

async function compose(
  sourceCurrency: string,
  targetCurrency: string,
  deps: Dependencies
) {
  return getConversionRatesForPair({
    sourceCurrency,
    targetCurrency,
    getGlobalRates: deps.getGlobalRates,
    getIranianBridge: deps.getIranianBridge,
  });
}

{
  const deps = dependencies({
    globalError: new Error("global must not run"),
    bridgeError: new Error("bridge must not run"),
  });
  expectEqual(await compose("eur", "EUR", deps), { EUR: 1 }, "same currency rates");
  expectEqual(deps.globalCalls, [], "same currency skips global rates");
  expectEqual(deps.bridgeCalls, 0, "same currency skips bridge");
}

for (const [source, target, expectedRates, amount, expectedAmount] of [
  ["IRT", "IRR", { IRR: 1, IRT: 0.1 }, 100, 1_000],
  ["IRR", "IRT", { IRT: 1, IRR: 10 }, 1_000, 100],
] as const) {
  const deps = dependencies({
    globalError: new Error("global must not run"),
    bridgeError: new Error("bridge must not run"),
  });
  const rates = await compose(source, target, deps);
  expectEqual(rates, expectedRates, `${source} to ${target} local rates`);
  expectClose(
    convertCurrency(amount, source, target, rates),
    expectedAmount,
    `${source} to ${target} local conversion`
  );
  expectEqual(deps.globalCalls, [], `${source} to ${target} skips global rates`);
  expectEqual(deps.bridgeCalls, 0, `${source} to ${target} skips bridge`);
}

{
  const deps = dependencies({ bridgeError: new Error("bridge unavailable") });
  const rates = await compose("EUR", "GBP", deps);
  expectClose(convertCurrency(100, "EUR", "GBP", rates), 62.5, "EUR to GBP");
  expectEqual(deps.globalCalls, ["GBP"], "global pair requests target base once");
  expectEqual(deps.bridgeCalls, 0, "global pair skips failing bridge");
}

for (const [source, target, amount, expectedAmount] of [
  ["USD", "IRT", 100, 20_000_000],
  ["USD", "IRR", 100, 200_000_000],
  ["IRT", "USD", 20_000_000, 100],
  ["IRR", "USD", 200_000_000, 100],
] as const) {
  const deps = dependencies({ globalError: new Error("global unavailable") });
  const rates = await compose(source, target, deps);
  expectClose(
    convertCurrency(amount, source, target, rates),
    expectedAmount,
    `${source} to ${target}`
  );
  expectEqual(deps.globalCalls, [], `${source} to ${target} skips global rates`);
  expectEqual(deps.bridgeCalls, 1, `${source} to ${target} calls bridge once`);
}

for (const [source, target, amount, expectedAmount, expectedBase] of [
  ["EUR", "IRT", 100, 25_000_000, "USD"],
  ["EUR", "IRR", 100, 250_000_000, "USD"],
  ["IRT", "EUR", 25_000_000, 100, "EUR"],
  ["IRR", "EUR", 250_000_000, 100, "EUR"],
] as const) {
  const deps = dependencies();
  const rates = await compose(source, target, deps);
  expectClose(
    convertCurrency(amount, source, target, rates),
    expectedAmount,
    `${source} to ${target}`
  );
  expectEqual(deps.globalCalls, [expectedBase], `${source} to ${target} global base`);
  expectEqual(deps.bridgeCalls, 1, `${source} to ${target} bridge count`);
}

{
  const bridgeError = new Error("bridge dependency failed");
  const deps = dependencies({ bridgeError });
  await expectRejects(
    () => compose("EUR", "IRT", deps),
    bridgeError.message,
    "required bridge failure propagates"
  );
  expectEqual(deps.globalCalls, ["USD"], "bridge failure pair calls required global once");
  expectEqual(deps.bridgeCalls, 1, "bridge failure calls bridge once");
}

{
  const globalError = new Error("global dependency failed");
  const deps = dependencies({ globalError });
  await expectRejects(
    () => compose("EUR", "GBP", deps),
    globalError.message,
    "required global failure propagates"
  );
  expectEqual(deps.globalCalls, ["GBP"], "global failure calls global once");
  expectEqual(deps.bridgeCalls, 0, "global failure does not call bridge");
}

{
  const deps = dependencies({ responseForBase: () => usdRates });
  await expectRejects(
    () => compose("IRT", "EUR", deps),
    "Global rates base does not match the requested target currency",
    "wrong dependency base"
  );
  expectEqual(deps.globalCalls, ["EUR"], "wrong base global call count");
  expectEqual(deps.bridgeCalls, 1, "wrong base bridge call count");
}

for (const [source, target, label] of [
  ["XYZ", "USD", "unknown source"],
  ["USD", "XYZ", "unknown target"],
] as const) {
  const deps = dependencies();
  await expectRejects(
    () => compose(source, target, deps),
    'Unknown canonical currency: "XYZ"',
    label
  );
  expectEqual(deps.globalCalls, [], `${label} skips global rates`);
  expectEqual(deps.bridgeCalls, 0, `${label} skips bridge`);
}

for (const [source, target, expectedMessage, label] of [
  [" ", "USD", "Source currency is required", "empty source"],
  ["USD", " ", "Target currency is required", "empty target"],
] as const) {
  const deps = dependencies();
  await expectRejects(
    () => compose(source, target, deps),
    expectedMessage,
    label
  );
  expectEqual(deps.globalCalls, [], `${label} skips global rates`);
  expectEqual(deps.bridgeCalls, 0, `${label} skips bridge`);
}

{
  const deps = dependencies({
    responseForBase: () => ({
      ...gbpRates,
      rates: { GBP: 1, USD: 2 },
    }),
  });
  await expectRejects(
    () => compose("EUR", "GBP", deps),
    "Required source conversion rate is unavailable",
    "missing required source rate"
  );
}

{
  const deps = dependencies({
    bridgeValue: { ...bridge, usdSellIrt: 0 },
  });
  await expectRejects(
    () => compose("USD", "IRT", deps),
    "Iranian bridge rate is invalid",
    "invalid required bridge"
  );
  expectEqual(deps.globalCalls, [], "invalid bridge pair skips global rates");
  expectEqual(deps.bridgeCalls, 1, "invalid bridge is requested once");
}

{
  const contaminatedGbp: NormalizedRatesResponse = {
    ...gbpRates,
    rates: { ...gbpRates.rates, IRT: -1, IRR: Number.POSITIVE_INFINITY },
  };
  const globalBefore = {
    ...contaminatedGbp,
    rates: { ...contaminatedGbp.rates },
  };
  const bridgeBefore = { ...bridge };
  const deps = dependencies({ responseForBase: () => contaminatedGbp });
  const rates = await compose("eur", "gbp", deps);
  expectEqual(rates.IRT, undefined, "fake global IRT does not leak");
  expectEqual(rates.IRR, undefined, "fake global IRR does not leak");
  expectEqual(contaminatedGbp, globalBefore, "global dependency response is not mutated");
  expectEqual(bridge, bridgeBefore, "bridge dependency response is not mutated");
  expectEqual(deps.globalCalls, ["GBP"], "lower-case target is normalized");
}

{
  const contaminatedEur: NormalizedRatesResponse = {
    ...eurRates,
    rates: { ...eurRates.rates, IRT: 7, IRR: 8 },
  };
  const globalBefore = {
    ...contaminatedEur,
    rates: { ...contaminatedEur.rates },
  };
  const bridgeBefore = { ...bridge };
  const deps = dependencies({ responseForBase: () => contaminatedEur });
  const rates = await compose("IRT", "EUR", deps);
  expectEqual(rates.IRT, 250_000, "fake global IRT is replaced by bridge derivation");
  expectEqual(rates.IRR, 2_500_000, "fake global IRR is replaced by bridge derivation");
  expectEqual(contaminatedEur, globalBefore, "cross-market global response is not mutated");
  expectEqual(bridge, bridgeBefore, "cross-market bridge response is not mutated");
  expectEqual(deps.globalCalls, ["EUR"], "cross-market global call count");
  expectEqual(deps.bridgeCalls, 1, "cross-market bridge call count");
}
