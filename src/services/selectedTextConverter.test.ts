import type {
  ExchangeRates,
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";
import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";
import { formatConvertedCurrency } from "../utils/displayFormatting";
import {
  convertSelectedText,
  getManualConversion,
  type SelectedTextConversionDependencies,
} from "./selectedTextConverter";

const rates: ExchangeRates = {
  AED: 3.67,
  EUR: 0.92,
  IRR: 420000,
  USD: 1,
};

const iranianBridge: IranianBridgeRate = {
  unit: "IRT",
  usdSellIrt: 200000,
  updatedAt: "2026-01-01T00:00:00Z",
  sourceUpdatedAt: null,
  provider: "ehinium",
};

const manualDependencies: SelectedTextConversionDependencies = {
  getRates: async () => rates,
  getGlobalRates: async (baseCurrency) =>
    baseCurrency === "EUR"
      ? normalizedRates("EUR", {
          AED: 3.67 / 0.92,
          EUR: 1,
          USD: 1 / 0.92,
        })
      : normalizedRates("USD", rates),
  getIranianBridge: async () => iranianBridge,
};

function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    ...defaultSettings,
    enabled: true,
    targetCurrency: "USD",
    converterMode: "everything",
    ...overrides,
  };
}

async function convert(
  text: string,
  overrides: Partial<UserSettings> = {}
): Promise<string | null> {
  return convertSelectedText(text, settings(overrides), {
    getRates: async () => rates,
    getIranianBridge: async () => iranianBridge,
  });
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

expectEqual(
  await convert("AED 16.99"),
  "$4.63",
  "selected currency conversion"
);
expectEqual(await convert("10 kg"), "22.05 lb", "selected unit conversion");
expectEqual(
  await convert("AED 16.99", { enabled: false }),
  null,
  "disabled selection conversion"
);
expectEqual(
  await convert("10 kg", { converterMode: "currencies" }),
  null,
  "currencies mode excludes units"
);
expectEqual(
  await convert("AED 16.99", { converterMode: "units" }),
  null,
  "units mode excludes currencies"
);
expectEqual(
  await convert("AED 16.99 and 10 kg"),
  "$4.63",
  "currency parser priority"
);
expectEqual(
  await convert("2021.04 IRR"),
  "$0.001011",
  "very small selected currency conversion"
);
expectEqual(await convert("not convertible"), null, "invalid selection");
expectEqual(
  await convert("5 ft", {
    converterMode: "units",
    unitSystem: "metric",
  }),
  "1.52 m",
  "unit system preference"
);
expectEqual(
  await convert("5 ft", {
    converterMode: "units",
    unitSystem: "metric",
    targetLengthUnit: "cm",
  }),
  "152.4 cm",
  "exact target preference"
);

const manualCurrency = await getManualConversion(
  "AED 16.99",
  settings(),
  manualDependencies
);
expectEqual(manualCurrency?.source, "16.99 AED", "manual currency source");
expectEqual(manualCurrency?.converted, "$4.63", "manual currency result");

const manualUnit = await getManualConversion(
  "10 kg",
  settings(),
  manualDependencies
);
expectEqual(manualUnit?.source, "10 kg", "manual unit source");
expectEqual(manualUnit?.converted, "22.05 lb", "manual unit result");

const tinyManualCurrency = await getManualConversion(
  "2021.04 IRR",
  settings(),
  manualDependencies
);
expectEqual(
  tinyManualCurrency?.converted,
  "$0.001011",
  "manual tiny currency result"
);

for (const [input, expectedSource, overrides] of [
  ["10000000IRR", "10,000,000 IRR", {}],
  ["10000000 irr", "10,000,000 IRR", {}],
  ["1234567.89 usd", "1,234,567.89 USD", { targetCurrency: "EUR" }],
  ["180CM", "180 cm", { converterMode: "units", targetLengthUnit: "in" }],
  ["10000kg", "10,000 kg", { converterMode: "units", targetWeightUnit: "lb" }],
] satisfies Array<[string, string, Partial<UserSettings>]>) {
  const result = await getManualConversion(
    input,
    settings(overrides),
    manualDependencies
  );

  expectEqual(result?.source, expectedSource, `formatted manual source ${input}`);
}

for (const validInput of ["80 eur", "80 Eur", "eur 80", "usd 100", "100 aed"]) {
  const targetCurrency = validInput.toLowerCase().includes("eur") ? "USD" : "EUR";
  const result = await getManualConversion(
    validInput,
    settings({ targetCurrency }),
    manualDependencies
  );

  if (!result) {
    throw new Error(`manual lowercase currency input ${validInput}: expected a result`);
  }
}

for (const invalidInput of ["Q70", "BN59-01312G", "iPhone 15", "Product 5%"]) {
  expectEqual(
    await getManualConversion(invalidInput, settings(), {
      ...manualDependencies,
    }),
    null,
    `manual invalid input ${invalidInput}`
  );
}

function normalizedRates(
  base: string,
  exchangeRates: ExchangeRates
): NormalizedRatesResponse {
  return {
    base,
    date: "2026-01-01",
    rates: exchangeRates,
    provider: "frankfurter",
  };
}

function selectedDependencies(
  getGlobalRates: (
    baseCurrency: string
  ) => Promise<NormalizedRatesResponse>
): SelectedTextConversionDependencies {
  return {
    getRates: async () => {
      throw new Error("legacy global-rate adapter should not be used");
    },
    getGlobalRates,
  };
}

async function withMockChrome<T>(
  sendMessage: (message: unknown) => Promise<unknown>,
  run: () => Promise<T>
): Promise<T> {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "chrome");

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { runtime: { sendMessage } },
  });

  try {
    return await run();
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "chrome", previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "chrome");
    }
  }
}

let globalCalls: string[] = [];
let bridgeMessages: unknown[] = [];

const globalResult = await withMockChrome(
  async (message) => {
    bridgeMessages.push(message);
    throw new Error("bridge must not be called");
  },
  () =>
    convertSelectedText(
      "AED 16.99",
      settings({ targetCurrency: "USD" }),
      selectedDependencies(async (baseCurrency) => {
        globalCalls.push(baseCurrency);
        return normalizedRates("USD", { AED: 3.67, USD: 1 });
      })
    )
);
expectEqual(globalResult, "$4.63", "orchestrated global conversion");
expectEqual(globalCalls.join(","), "USD", "global conversion rate call");
expectEqual(bridgeMessages.length, 0, "global conversion bridge calls");

type PairCase = {
  description: string;
  input: string;
  targetCurrency: string;
  expectedAmount: number;
  expectedGlobalBase: string | null;
};

for (const pair of [
  {
    description: "USD to IRT",
    input: "USD 100",
    targetCurrency: "IRT",
    expectedAmount: 20000000,
    expectedGlobalBase: null,
  },
  {
    description: "USD to IRR",
    input: "USD 100",
    targetCurrency: "IRR",
    expectedAmount: 200000000,
    expectedGlobalBase: null,
  },
  {
    description: "IRT to USD",
    input: "IRT 20000000",
    targetCurrency: "USD",
    expectedAmount: 100,
    expectedGlobalBase: null,
  },
  {
    description: "IRR to USD",
    input: "IRR 200000000",
    targetCurrency: "USD",
    expectedAmount: 100,
    expectedGlobalBase: null,
  },
  {
    description: "EUR to IRT",
    input: "EUR 100",
    targetCurrency: "IRT",
    expectedAmount: 40000000,
    expectedGlobalBase: "USD",
  },
  {
    description: "EUR to IRR",
    input: "EUR 100",
    targetCurrency: "IRR",
    expectedAmount: 400000000,
    expectedGlobalBase: "USD",
  },
  {
    description: "IRT to EUR",
    input: "IRT 20000000",
    targetCurrency: "EUR",
    expectedAmount: 50,
    expectedGlobalBase: "EUR",
  },
  {
    description: "IRR to EUR",
    input: "IRR 200000000",
    targetCurrency: "EUR",
    expectedAmount: 50,
    expectedGlobalBase: "EUR",
  },
] satisfies PairCase[]) {
  globalCalls = [];
  bridgeMessages = [];

  const result = await withMockChrome(
    async (message) => {
      bridgeMessages.push(message);
      return {
        ok: true,
        rate: iranianBridge,
        freshness: "fresh",
        source: "network",
      };
    },
    () =>
      convertSelectedText(
        pair.input,
        settings({ targetCurrency: pair.targetCurrency }),
        selectedDependencies(async (baseCurrency) => {
          globalCalls.push(baseCurrency);
          return baseCurrency === "USD"
            ? normalizedRates("USD", { EUR: 0.5, USD: 1 })
            : normalizedRates("EUR", { EUR: 1, USD: 2 });
        })
      )
  );

  expectEqual(
    result,
    formatConvertedCurrency(pair.expectedAmount, pair.targetCurrency),
    pair.description
  );
  expectEqual(
    globalCalls.join(","),
    pair.expectedGlobalBase ?? "",
    `${pair.description} global dependency calls`
  );
  expectEqual(
    bridgeMessages.length,
    1,
    `${pair.description} bridge message calls`
  );
  expectEqual(
    JSON.stringify(bridgeMessages[0]),
    JSON.stringify({ type: "GET_IRANIAN_BRIDGE_RATE" }),
    `${pair.description} bridge request`
  );
}

for (const localPair of [
  {
    description: "IRT to IRR local conversion",
    input: "IRT 100",
    targetCurrency: "IRR",
    expectedAmount: 1000,
  },
  {
    description: "IRR to IRT local conversion",
    input: "IRR 1000",
    targetCurrency: "IRT",
    expectedAmount: 100,
  },
]) {
  globalCalls = [];
  bridgeMessages = [];

  const result = await withMockChrome(
    async (message) => {
      bridgeMessages.push(message);
      throw new Error("both dependencies are unavailable");
    },
    () =>
      convertSelectedText(
        localPair.input,
        settings({ targetCurrency: localPair.targetCurrency }),
        selectedDependencies(async (baseCurrency) => {
          globalCalls.push(baseCurrency);
          throw new Error("both dependencies are unavailable");
        })
      )
  );

  expectEqual(
    result,
    formatConvertedCurrency(localPair.expectedAmount, localPair.targetCurrency),
    localPair.description
  );
  expectEqual(globalCalls.length, 0, `${localPair.description} global calls`);
  expectEqual(bridgeMessages.length, 0, `${localPair.description} bridge calls`);
}

for (const alias of ["TMN 200000", "تومانء ۲۰۰۰۰۰"]) {
  bridgeMessages = [];
  const result = await withMockChrome(
    async (message) => {
      bridgeMessages.push(message);
      return {
        ok: true,
        rate: iranianBridge,
        freshness: "fresh",
        source: "memory",
      };
    },
    () =>
      convertSelectedText(
        alias,
        settings({ targetCurrency: "USD" }),
        selectedDependencies(async () => {
          throw new Error("global rates must not be called");
        })
      )
  );

  expectEqual(result, "$1.00", `canonical IRT alias ${alias}`);
  expectEqual(bridgeMessages.length, 1, `alias bridge call ${alias}`);
}

const bridgeFailureResult = await withMockChrome(
  async () => {
    throw new Error("Bearer super-secret-token");
  },
  async () => ({
    global: await convertSelectedText(
      "AED 16.99",
      settings({ targetCurrency: "USD" }),
      selectedDependencies(async () =>
        normalizedRates("USD", { AED: 3.67, USD: 1 })
      )
    ),
    iranian: await convertSelectedText(
      "USD 100",
      settings({ targetCurrency: "IRT", converterMode: "currencies" }),
      selectedDependencies(async () => {
        throw new Error("global rates must not be called");
      })
    ),
  })
);
expectEqual(
  bridgeFailureResult.global,
  "$4.63",
  "bridge failure does not affect global conversion"
);
expectEqual(
  bridgeFailureResult.iranian,
  null,
  "bridge failure is isolated and sanitized"
);

for (const response of [
  { ok: false, error: "Bearer hidden-token" },
  {
    ok: true,
    rate: { ...iranianBridge, usdSellIrt: "200000" },
    freshness: "fresh",
    source: "network",
  },
  { ok: true, rate: iranianBridge },
  undefined,
]) {
  expectEqual(
    await withMockChrome(
      async () => response,
      () =>
        convertSelectedText(
          "USD 100",
          settings({ targetCurrency: "IRT", converterMode: "currencies" }),
          selectedDependencies(async () => {
            throw new Error("global rates must not be called");
          })
        )
    ),
    null,
    "invalid background bridge response"
  );
}

const previousChromeDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "chrome"
);
Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {},
});
try {
  expectEqual(
    await convertSelectedText(
      "USD 100",
      settings({ targetCurrency: "IRT", converterMode: "currencies" }),
      selectedDependencies(async () => {
        throw new Error("global rates must not be called");
      })
    ),
    null,
    "missing runtime only affects bridge conversion"
  );
  expectEqual(
    await convertSelectedText(
      "AED 16.99",
      settings({ targetCurrency: "USD" }),
      selectedDependencies(async () =>
        normalizedRates("USD", { AED: 3.67, USD: 1 })
      )
    ),
    "$4.63",
    "missing runtime preserves global conversion"
  );
  expectEqual(
    await convertSelectedText(
      "IRT 100",
      settings({ targetCurrency: "IRR" }),
      selectedDependencies(async () => {
        throw new Error("global rates must not be called");
      })
    ),
    formatConvertedCurrency(1000, "IRR"),
    "missing runtime preserves local Iranian conversion"
  );
} finally {
  if (previousChromeDescriptor) {
    Object.defineProperty(globalThis, "chrome", previousChromeDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "chrome");
  }
}

type ManualPairCase = {
  description: string;
  input: string;
  targetCurrency: string;
  expectedAmount: number;
  expectedGlobalBase: string | null;
};

for (const pair of [
  {
    description: "manual USD to IRT",
    input: "USD 100",
    targetCurrency: "IRT",
    expectedAmount: 20000000,
    expectedGlobalBase: null,
  },
  {
    description: "manual USD to IRR",
    input: "USD 100",
    targetCurrency: "IRR",
    expectedAmount: 200000000,
    expectedGlobalBase: null,
  },
  {
    description: "manual IRT to USD",
    input: "IRT 20000000",
    targetCurrency: "USD",
    expectedAmount: 100,
    expectedGlobalBase: null,
  },
  {
    description: "manual IRR to USD",
    input: "IRR 200000000",
    targetCurrency: "USD",
    expectedAmount: 100,
    expectedGlobalBase: null,
  },
  {
    description: "manual EUR to IRT",
    input: "EUR 100",
    targetCurrency: "IRT",
    expectedAmount: 25000000,
    expectedGlobalBase: "USD",
  },
  {
    description: "manual EUR to IRR",
    input: "EUR 100",
    targetCurrency: "IRR",
    expectedAmount: 250000000,
    expectedGlobalBase: "USD",
  },
  {
    description: "manual IRT to EUR",
    input: "IRT 25000000",
    targetCurrency: "EUR",
    expectedAmount: 100,
    expectedGlobalBase: "EUR",
  },
  {
    description: "manual IRR to EUR",
    input: "IRR 250000000",
    targetCurrency: "EUR",
    expectedAmount: 100,
    expectedGlobalBase: "EUR",
  },
] satisfies ManualPairCase[]) {
  const manualGlobalCalls: string[] = [];
  let manualBridgeCalls = 0;
  const result = await getManualConversion(
    pair.input,
    settings({ targetCurrency: pair.targetCurrency }),
    {
      getRates: async () => {
        throw new Error("legacy rates must not be used");
      },
      getGlobalRates: async (baseCurrency) => {
        manualGlobalCalls.push(baseCurrency);
        return baseCurrency === "USD"
          ? normalizedRates("USD", { USD: 1, EUR: 0.8, GBP: 0.5 })
          : normalizedRates("EUR", { EUR: 1, USD: 1.25, GBP: 0.625 });
      },
      getIranianBridge: async () => {
        manualBridgeCalls += 1;
        return iranianBridge;
      },
    }
  );

  expectEqual(
    result?.converted,
    formatConvertedCurrency(pair.expectedAmount, pair.targetCurrency),
    pair.description
  );
  expectEqual(
    manualGlobalCalls.join(","),
    pair.expectedGlobalBase ?? "",
    `${pair.description} global calls`
  );
  expectEqual(manualBridgeCalls, 1, `${pair.description} bridge calls`);
}

for (const pair of [
  ["IRT 100", "IRR", 1000, "manual IRT to IRR"],
  ["IRR 1000", "IRT", 100, "manual IRR to IRT"],
] as const) {
  let networkCalls = 0;
  const [input, targetCurrency, expectedAmount, description] = pair;
  const result = await getManualConversion(
    input,
    settings({ targetCurrency }),
    {
      getRates: async () => {
        networkCalls += 1;
        throw new Error("Bearer fake-token");
      },
      getGlobalRates: async () => {
        networkCalls += 1;
        throw new Error("Bearer fake-token");
      },
      getIranianBridge: async () => {
        networkCalls += 1;
        throw new Error("Bearer fake-token");
      },
    }
  );

  expectEqual(
    result?.converted,
    formatConvertedCurrency(expectedAmount, targetCurrency),
    description
  );
  expectEqual(networkCalls, 0, `${description} network calls`);
}

{
  let dependencyCalls = 0;
  const result = await getManualConversion(
    "IRT 100",
    settings({ targetCurrency: "IRT" }),
    {
      getRates: async () => {
        dependencyCalls += 1;
        return rates;
      },
      getGlobalRates: async () => {
        dependencyCalls += 1;
        return normalizedRates("USD", rates);
      },
      getIranianBridge: async () => {
        dependencyCalls += 1;
        return iranianBridge;
      },
    }
  );
  expectEqual(result, null, "manual same currency result");
  expectEqual(dependencyCalls, 0, "manual same currency dependency calls");
}

{
  let bridgeCalls = 0;
  const result = await getManualConversion(
    "EUR 80",
    settings({ targetCurrency: "USD" }),
    {
      getRates: async () => {
        throw new Error("legacy rates must not be used");
      },
      getGlobalRates: async () =>
        normalizedRates("USD", { USD: 1, EUR: 0.8 }),
      getIranianBridge: async () => {
        bridgeCalls += 1;
        throw new Error("Bearer fake-token Authorization");
      },
    }
  );
  expectEqual(result?.converted, "$100.00", "manual global regression");
  expectEqual(bridgeCalls, 0, "manual global skips bridge");
}

for (const [input, sourceDescription] of [
  ["TMN 200000", "TMN"],
  ["Toman 200000", "Toman"],
  ["تومانءء ۲۰۰۰۰۰", "decorated Toman"],
  ["Rial 2000000", "Rial"],
  ["ریالء ۲۰۰۰۰۰۰", "decorated Rial"],
] as const) {
  const result = await getManualConversion(
    input,
    settings({ targetCurrency: "USD" }),
    manualDependencies
  );
  expectEqual(result?.converted, "$1.00", `manual alias ${sourceDescription}`);
}

for (const invalidInput of ["T 100", "ت ۱۰۰", "توم ۱۰۰", "ری ۱۰۰"]) {
  expectEqual(
    await getManualConversion(invalidInput, settings(), manualDependencies),
    null,
    `manual ambiguous alias ${invalidInput}`
  );
}

for (const getIranianBridge of [
  async (): Promise<IranianBridgeRate> => {
    throw new Error("Bearer fake-token Authorization");
  },
  async (): Promise<IranianBridgeRate> =>
    ({ ...iranianBridge, usdSellIrt: 0 } as IranianBridgeRate),
]) {
  expectEqual(
    await getManualConversion(
      "USD 100",
      settings({ targetCurrency: "IRT", converterMode: "currencies" }),
      {
        getRates: async () => rates,
        getIranianBridge,
      }
    ),
    null,
    "manual invalid bridge fails safely"
  );
}

expectEqual(
  (
    await getManualConversion("10 kg", settings(), {
      getRates: async () => {
        throw new Error("Bearer fake-token");
      },
      getGlobalRates: async () => {
        throw new Error("Bearer fake-token");
      },
      getIranianBridge: async () => {
        throw new Error("Bearer fake-token");
      },
    })
  )?.converted,
  "22.05 lb",
  "manual units ignore currency dependency failures"
);

expectEqual(
  (
    await getManualConversion(
      "USD 100",
      settings({ targetCurrency: "IRT" }),
      manualDependencies
    )
  )?.converted,
  "20,000,000 IRT",
  "popup manual IRT display policy"
);

expectEqual(
  await convertSelectedText(
    "USD 100",
    settings({ targetCurrency: "IRT" }),
    manualDependencies
  ),
  "20,000,000 IRT",
  "selected-text IRT display policy"
);

for (const input of ["IRR 1000", "Rial 1000", "ریالء ۱۰۰۰"]) {
  expectEqual(
    (
      await getManualConversion(
        input,
        settings({ targetCurrency: "IRT" }),
        manualDependencies
      )
    )?.converted,
    "100 IRT",
    `Rial input displays Toman output ${input}`
  );
}
