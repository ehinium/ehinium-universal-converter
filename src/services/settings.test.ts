import type { UserSettings } from "../types/settings";
import {
  fiatCurrencies,
  selectableTargetCurrencies,
} from "../data/currencies";
import { defaultSettings } from "../utils/defaultSettings";
import { getSettings, normalizeSettings } from "./settings";

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function expectDefaults(
  overrides: Partial<UserSettings>,
  description: string
): void {
  expectEqual(
    normalizeSettings(overrides),
    { ...defaultSettings, ...overrides },
    description
  );
}

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      sync: {
        get: async () => ({}),
      },
    },
  },
});

expectEqual(await getSettings(), defaultSettings, "empty storage defaults");

expectEqual(
  normalizeSettings({ enabled: false, targetCurrency: "usd" }),
  {
    ...defaultSettings,
    enabled: false,
    targetCurrency: "USD",
  },
  "partial old settings upgrade"
);

expectEqual(
  normalizeSettings({ converterMode: "invalid" }).converterMode,
  defaultSettings.converterMode,
  "invalid converter mode"
);
expectEqual(
  normalizeSettings({ badgeStyle: "invalid" }).badgeStyle,
  defaultSettings.badgeStyle,
  "invalid badge style"
);
expectEqual(
  normalizeSettings({ unitSystem: "invalid" }).unitSystem,
  defaultSettings.unitSystem,
  "invalid unit system"
);
expectEqual(
  normalizeSettings({ targetCurrency: "NOT" }).targetCurrency,
  defaultSettings.targetCurrency,
  "invalid target currency"
);
expectEqual(
  normalizeSettings({
    targetCurrency: "IRR",
    enabled: false,
    whitelist: ["example.com"],
  }),
  {
    ...defaultSettings,
    targetCurrency: "IRT",
    enabled: false,
    whitelist: ["example.com"],
  },
  "persisted IRR target migrates to IRT"
);
expectEqual(
  selectableTargetCurrencies.some((currency) => currency.code === "IRT"),
  true,
  "IRT remains selectable"
);
expectEqual(
  selectableTargetCurrencies.some((currency) => currency.code === "IRR"),
  false,
  "IRR is not selectable"
);
expectEqual(
  selectableTargetCurrencies.some((currency) => currency.code === "USD"),
  true,
  "global targets remain selectable"
);
expectEqual(
  fiatCurrencies.some((currency) => currency.code === "IRR"),
  true,
  "IRR remains canonical parser metadata"
);
expectEqual(
  normalizeSettings({
    whitelist: ["amazon.com", "", 42],
    blacklist: ["example.com", null],
  }),
  {
    ...defaultSettings,
    whitelist: ["amazon.com"],
    blacklist: ["example.com"],
  },
  "invalid domain entries"
);

expectEqual(
  normalizeSettings({
    enabled: "yes",
    badgeVisibility: "sometimes",
    targetLengthUnit: "yards",
    targetWeightUnit: "stone",
    targetTemperatureUnit: "kelvin",
    whitelist: "amazon.com",
    blacklist: 42,
  }),
  defaultSettings,
  "remaining invalid settings reset to defaults"
);

const validSettings: UserSettings = {
  targetCurrency: "USD",
  enabled: false,
  converterMode: "everything",
  badgeStyle: "compact",
  badgeVisibility: "hover",
  unitSystem: "imperial",
  targetLengthUnit: "ft",
  targetWeightUnit: "lb",
  targetTemperatureUnit: "f",
  whitelist: ["amazon.com"],
  blacklist: ["example.com"],
};

expectDefaults(validSettings, "valid settings preserved");
