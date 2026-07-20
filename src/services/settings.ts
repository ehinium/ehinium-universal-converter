import type {
  BadgeStyle,
  BadgeVisibility,
  ConverterMode,
  TargetLengthUnit,
  TargetTemperatureUnit,
  TargetWeightUnit,
  UnitSystem,
  UserSettings,
} from "../types/settings";
import { selectableTargetCurrencies } from "../data/currencies";
import { defaultSettings } from "../utils/defaultSettings";

const STORAGE_KEY = "euc-settings";
const supportedCurrencyCodes = new Set(
  selectableTargetCurrencies.map((currency) => currency.code)
);

export function normalizeSettings(value: unknown): UserSettings {
  if (typeof value !== "object" || value === null) {
    return cloneDefaultSettings();
  }

  const stored = value as Record<string, unknown>;

  return {
    targetCurrency: normalizeTargetCurrency(stored.targetCurrency),
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
    badgeVisibility: isBadgeVisibility(stored.badgeVisibility)
      ? stored.badgeVisibility
      : defaultSettings.badgeVisibility,
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
    whitelist: normalizeDomainList(stored.whitelist, defaultSettings.whitelist),
    blacklist: normalizeDomainList(stored.blacklist, defaultSettings.blacklist),
  };
}

function cloneDefaultSettings(): UserSettings {
  return {
    ...defaultSettings,
    whitelist: [...defaultSettings.whitelist],
    blacklist: [...defaultSettings.blacklist],
  };
}

function normalizeTargetCurrency(value: unknown): string {
  if (typeof value !== "string") {
    return defaultSettings.targetCurrency;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "IRR") {
    return "IRT";
  }

  return supportedCurrencyCodes.has(normalized)
    ? normalized
    : defaultSettings.targetCurrency;
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

function isBadgeVisibility(value: unknown): value is BadgeVisibility {
  return value === "always" || value === "hover";
}

function isConverterMode(value: unknown): value is ConverterMode {
  return value === "currencies" || value === "units" || value === "everything";
}

function normalizeDomainList(
  value: unknown,
  fallback: readonly string[]
): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0
  );
}

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);

  return normalizeSettings(result[STORAGE_KEY]);
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
      callback(normalizeSettings(settingsChange.newValue));
    }
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
