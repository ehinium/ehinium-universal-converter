import type { UserSettings } from "../types/settings";

export const defaultSettings: UserSettings = {
  targetCurrency: "EUR",
  enabled: true,
  converterMode: "currencies",
  badgeStyle: "default",
  whitelist: [],
  blacklist: [],
};
