export type ConverterMode = "currencies" | "units" | "everything";

export type UserSettings = {
  targetCurrency: string;
  enabled: boolean;
  converterMode: ConverterMode;
  whitelist: string[];
  blacklist: string[];
};
