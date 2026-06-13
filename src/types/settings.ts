export type ConverterMode = "currencies" | "units" | "everything";
export type BadgeStyle = "default" | "compact" | "minimal";
export type BadgeVisibility = "always" | "hover";
export type UnitSystem = "auto" | "metric" | "imperial";
export type TargetLengthUnit =
  | "auto"
  | "mm"
  | "cm"
  | "m"
  | "km"
  | "in"
  | "ft"
  | "yd"
  | "mi";
export type TargetWeightUnit = "auto" | "mg" | "g" | "kg" | "oz" | "lb";
export type TargetTemperatureUnit = "auto" | "c" | "f";

export type UserSettings = {
  targetCurrency: string;
  enabled: boolean;
  converterMode: ConverterMode;
  badgeStyle: BadgeStyle;
  badgeVisibility: BadgeVisibility;
  unitSystem: UnitSystem;
  targetLengthUnit: TargetLengthUnit;
  targetWeightUnit: TargetWeightUnit;
  targetTemperatureUnit: TargetTemperatureUnit;
  whitelist: string[];
  blacklist: string[];
};
