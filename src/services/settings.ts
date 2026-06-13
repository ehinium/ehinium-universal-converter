import type { BadgeStyle, ConverterMode, UserSettings } from "../types/settings";
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
    whitelist: isStringArray(stored.whitelist)
      ? stored.whitelist
      : defaultSettings.whitelist,
    blacklist: isStringArray(stored.blacklist)
      ? stored.blacklist
      : defaultSettings.blacklist,
  };
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
