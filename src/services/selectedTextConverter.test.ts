import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";
import { convertSelectedText } from "./selectedTextConverter";

const rates: ExchangeRates = {
  AED: 3.67,
  EUR: 0.92,
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
