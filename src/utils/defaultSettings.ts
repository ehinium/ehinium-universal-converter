import type { UserSettings } from "../types/settings";

export const defaultSettings: UserSettings = {
  targetCurrency: "EUR",
  enabled: true,
  converterMode: "currencies",
  badgeStyle: "default",
  unitSystem: "auto",
  targetLengthUnit: "auto",
  targetWeightUnit: "auto",
  targetTemperatureUnit: "auto",
  whitelist: [],
  blacklist: [],
};
