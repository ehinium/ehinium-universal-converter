export type ConverterMode = "currencies" | "units" | "everything";
export type BadgeStyle = "default" | "compact" | "minimal";

export type UserSettings = {
  targetCurrency: string;
  enabled: boolean;
  converterMode: ConverterMode;
  badgeStyle: BadgeStyle;
  whitelist: string[];
  blacklist: string[];
};
