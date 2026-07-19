import type {
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";
import { convertCurrency } from "../utils/currencyConverter";
import { composeConversionRates } from "./conversionRates";

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

function expectThrows(
  action: () => unknown,
  expectedMessage: string,
  description: string
): void {
  let caught: unknown;

  try {
    action();
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
  provider: "frankfurter+fawaz",
  rates: { EUR: 1, USD: 1.25, GBP: 0.625 },
};

const irtTargetRates = composeConversionRates({
  targetCurrency: "IRT",
  globalRates: usdRates,
  iranianBridge: bridge,
});
const irrTargetRates = composeConversionRates({
  targetCurrency: "IRR",
  globalRates: usdRates,
  iranianBridge: bridge,
});
const eurTargetRates = composeConversionRates({
  targetCurrency: "EUR",
  globalRates: eurRates,
  iranianBridge: bridge,
});
const usdTargetRates = composeConversionRates({
  targetCurrency: "USD",
  globalRates: usdRates,
  iranianBridge: bridge,
});

expectClose(
  convertCurrency(100, "USD", "IRT", irtTargetRates),
  20_000_000,
  "USD to IRT"
);
expectClose(
  convertCurrency(20_000_000, "IRT", "USD", usdTargetRates),
  100,
  "IRT to USD"
);
expectClose(
  convertCurrency(100, "EUR", "IRT", irtTargetRates),
  25_000_000,
  "EUR to IRT"
);
expectClose(
  convertCurrency(25_000_000, "IRT", "EUR", eurTargetRates),
  100,
  "IRT to EUR"
);
expectClose(
  convertCurrency(1_000, "IRR", "IRT", irtTargetRates),
  100,
  "IRR to IRT"
);
expectClose(
  convertCurrency(100, "IRT", "IRR", irrTargetRates),
  1_000,
  "IRT to IRR"
);
expectClose(
  convertCurrency(2_500_000_000, "IRR", "EUR", eurTargetRates),
  1_000,
  "IRR to EUR"
);
expectClose(
  convertCurrency(100, "EUR", "IRR", irrTargetRates),
  250_000_000,
  "EUR to IRR"
);

const globalOnlyRates = composeConversionRates({
  targetCurrency: "EUR",
  globalRates: eurRates,
});
expectEqual(globalOnlyRates, eurRates.rates, "global-to-global rates remain unchanged");
expectEqual(globalOnlyRates.IRT, undefined, "global target without bridge excludes IRT");
expectEqual(globalOnlyRates.IRR, undefined, "global target without bridge excludes IRR");
expectClose(
  convertCurrency(0.625, "GBP", "EUR", globalOnlyRates),
  1,
  "global-to-global division semantics"
);
expectClose(
  convertCurrency(100, "EUR", "EUR", globalOnlyRates),
  100,
  "same global currency remains valid"
);
expectEqual(eurTargetRates.IRT, 250_000, "global target derives IRT");
expectEqual(eurTargetRates.IRR, 2_500_000, "global target derives IRR");

const localIrtRates = composeConversionRates({
  targetCurrency: "IRT",
  iranianBridge: bridge,
});
const localIrrRates = composeConversionRates({
  targetCurrency: "IRR",
  iranianBridge: bridge,
});
expectEqual(
  localIrtRates,
  { USD: 1 / 200_000, IRT: 1, IRR: 10 },
  "IRT target works without global rates"
);
expectEqual(
  localIrrRates,
  { USD: 1 / 2_000_000, IRR: 1, IRT: 0.1 },
  "IRR target works without global rates"
);
expectClose(
  convertCurrency(50, "IRT", "IRT", localIrtRates),
  50,
  "same Iranian currency remains valid"
);

const contaminatedUsdRates: NormalizedRatesResponse = {
  ...usdRates,
  rates: { ...usdRates.rates, IRT: -99, IRR: Number.POSITIVE_INFINITY },
};
const contaminatedBefore = {
  global: { ...contaminatedUsdRates, rates: { ...contaminatedUsdRates.rates } },
  bridge: { ...bridge },
};
const replacedIranianRates = composeConversionRates({
  targetCurrency: "IRT",
  globalRates: contaminatedUsdRates,
  iranianBridge: bridge,
});
expectEqual(replacedIranianRates.IRT, 1, "fake global IRT is replaced");
expectEqual(replacedIranianRates.IRR, 10, "fake global IRR is replaced");
expectEqual(
  contaminatedUsdRates,
  contaminatedBefore.global,
  "global input is not mutated"
);
expectEqual(bridge, contaminatedBefore.bridge, "bridge input is not mutated");

expectThrows(
  () => composeConversionRates({ targetCurrency: " " }),
  "Target currency is required",
  "empty target"
);
expectThrows(
  () => composeConversionRates({ targetCurrency: "EUR" }),
  "Global rates are required for the requested target currency",
  "missing global rates"
);
expectThrows(
  () =>
    composeConversionRates({ targetCurrency: "EUR", globalRates: usdRates }),
  "Global rates base does not match the requested target currency",
  "wrong global target base"
);
expectThrows(
  () => composeConversionRates({ targetCurrency: "IRT" }),
  "Iranian bridge rate is required",
  "missing IRT bridge"
);
expectThrows(
  () => composeConversionRates({ targetCurrency: "IRR" }),
  "Iranian bridge rate is required",
  "missing IRR bridge"
);
expectThrows(
  () =>
    composeConversionRates({
      targetCurrency: "IRT",
      globalRates: eurRates,
      iranianBridge: bridge,
    }),
  "Iranian target composition requires USD-based global rates",
  "Iranian target wrong global base"
);

for (const invalidValue of [
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
]) {
  expectThrows(
    () =>
      composeConversionRates({
        targetCurrency: "IRT",
        iranianBridge: { ...bridge, usdSellIrt: invalidValue },
      }),
    "Iranian bridge rate is invalid",
    `invalid bridge ${String(invalidValue)}`
  );
}

expectThrows(
  () =>
    composeConversionRates({
      targetCurrency: "EUR",
      globalRates: {
        ...eurRates,
        rates: { ...eurRates.rates, USD: Number.MAX_VALUE },
      },
      iranianBridge: { ...bridge, usdSellIrt: Number.MAX_VALUE },
    }),
  "Derived conversion rate is invalid",
  "non-finite global-target derived rate"
);
expectThrows(
  () =>
    composeConversionRates({
      targetCurrency: "IRR",
      iranianBridge: { ...bridge, usdSellIrt: Number.MAX_VALUE },
    }),
  "Derived conversion rate is invalid",
  "non-finite Iranian-target denominator"
);
expectThrows(
  () =>
    composeConversionRates({
      targetCurrency: "USD",
      globalRates: {
        ...usdRates,
        rates: { ...usdRates.rates, EUR: "0.8" },
      } as unknown as NormalizedRatesResponse,
    }),
  "Global rates response is invalid",
  "malformed global rate"
);
