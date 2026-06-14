import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";
import {
  convertSelectedText,
  getManualConversion,
} from "./selectedTextConverter";

const rates: ExchangeRates = {
  AED: 3.67,
  EUR: 0.92,
  IRR: 420000,
  USD: 1,
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
expectEqual(await convert("10 kg"), "22 lb", "selected unit conversion");
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
  { getRates: async () => rates }
);
expectEqual(manualCurrency?.source, "16.99 AED", "manual currency source");
expectEqual(manualCurrency?.converted, "$4.63", "manual currency result");

const manualUnit = await getManualConversion(
  "10 kg",
  settings(),
  { getRates: async () => rates }
);
expectEqual(manualUnit?.source, "10 kg", "manual unit source");
expectEqual(manualUnit?.converted, "22 lb", "manual unit result");

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
    { getRates: async () => rates }
  );

  expectEqual(result?.source, expectedSource, `formatted manual source ${input}`);
}

for (const validInput of ["80 eur", "80 Eur", "eur 80", "usd 100", "100 aed"]) {
  const targetCurrency = validInput.toLowerCase().includes("eur") ? "USD" : "EUR";
  const result = await getManualConversion(
    validInput,
    settings({ targetCurrency }),
    { getRates: async () => rates }
  );

  if (!result) {
    throw new Error(`manual lowercase currency input ${validInput}: expected a result`);
  }
}

for (const invalidInput of ["Q70", "BN59-01312G", "iPhone 15", "Product 5%"]) {
  expectEqual(
    await getManualConversion(invalidInput, settings(), {
      getRates: async () => rates,
    }),
    null,
    `manual invalid input ${invalidInput}`
  );
}
