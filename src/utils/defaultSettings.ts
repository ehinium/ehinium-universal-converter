import type { UserSettings } from "../types/settings";

export const defaultSettings: UserSettings = {
  targetCurrency: "USD",
  enabled: true,
  converterMode: "everything",
  badgeStyle: "default",
  badgeVisibility: "always",
  unitSystem: "auto",
  targetLengthUnit: "auto",
  targetWeightUnit: "auto",
  targetTemperatureUnit: "auto",
  whitelist: [],
  blacklist: [],
};
