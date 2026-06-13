import type {
  BadgeStyle,
  ConverterMode,
  TargetLengthUnit,
  TargetTemperatureUnit,
  TargetWeightUnit,
  UnitSystem,
  UserSettings,
} from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";

const STORAGE_KEY = "euc-settings";

function mergeSettings(value: unknown): UserSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultSettings };
  }

  const stored = value as Record<string, unknown>;

  return {
    targetCurrency:
      typeof stored.targetCurrency === "string"
        ? stored.targetCurrency
        : defaultSettings.targetCurrency,
    enabled:
      typeof stored.enabled === "boolean"
        ? stored.enabled
        : defaultSettings.enabled,
    converterMode: isConverterMode(stored.converterMode)
      ? stored.converterMode
      : defaultSettings.converterMode,
    badgeStyle: isBadgeStyle(stored.badgeStyle)
      ? stored.badgeStyle
      : defaultSettings.badgeStyle,
    unitSystem: isUnitSystem(stored.unitSystem)
      ? stored.unitSystem
      : defaultSettings.unitSystem,
    targetLengthUnit: isTargetLengthUnit(stored.targetLengthUnit)
      ? stored.targetLengthUnit
      : defaultSettings.targetLengthUnit,
    targetWeightUnit: isTargetWeightUnit(stored.targetWeightUnit)
      ? stored.targetWeightUnit
      : defaultSettings.targetWeightUnit,
    targetTemperatureUnit: isTargetTemperatureUnit(stored.targetTemperatureUnit)
      ? stored.targetTemperatureUnit
      : defaultSettings.targetTemperatureUnit,
    whitelist: isStringArray(stored.whitelist)
      ? stored.whitelist
      : defaultSettings.whitelist,
    blacklist: isStringArray(stored.blacklist)
      ? stored.blacklist
      : defaultSettings.blacklist,
  };
}

function isTargetLengthUnit(value: unknown): value is TargetLengthUnit {
  return (
    value === "auto" ||
    value === "mm" ||
    value === "cm" ||
    value === "m" ||
    value === "km" ||
    value === "in" ||
    value === "ft" ||
    value === "yd" ||
    value === "mi"
  );
}

function isUnitSystem(value: unknown): value is UnitSystem {
  return value === "auto" || value === "metric" || value === "imperial";
}

function isTargetWeightUnit(value: unknown): value is TargetWeightUnit {
  return (
    value === "auto" ||
    value === "mg" ||
    value === "g" ||
    value === "kg" ||
    value === "oz" ||
    value === "lb"
  );
}

function isTargetTemperatureUnit(
  value: unknown
): value is TargetTemperatureUnit {
  return value === "auto" || value === "c" || value === "f";
}

function isBadgeStyle(value: unknown): value is BadgeStyle {
  return value === "default" || value === "compact" || value === "minimal";
}

function isConverterMode(value: unknown): value is ConverterMode {
  return value === "currencies" || value === "units" || value === "everything";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);

  return mergeSettings(result[STORAGE_KEY]);
}

export async function saveSettings(
  settings: UserSettings
): Promise<void> {
  await chrome.storage.sync.set({
    [STORAGE_KEY]: settings,
  });
}

export function subscribeToSettingsChanges(
  callback: (settings: UserSettings) => void
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    const settingsChange = changes[STORAGE_KEY];

    if (areaName === "sync" && settingsChange) {
      callback(mergeSettings(settingsChange.newValue));
    }
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
