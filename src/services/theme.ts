import type { ResolvedTheme, ThemePreference } from "../types/theme";

export const THEME_STORAGE_KEY = "euc-theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return preference;
}

function hasSyncStorage(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      chrome.storage?.sync !== undefined
    );
  } catch {
    return false;
  }
}

export async function getThemePreference(): Promise<ThemePreference> {
  if (!hasSyncStorage()) {
    return DEFAULT_THEME_PREFERENCE;
  }

  try {
    const result = await chrome.storage.sync.get(THEME_STORAGE_KEY);
    return normalizeThemePreference(result[THEME_STORAGE_KEY]);
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export async function saveThemePreference(
  preference: ThemePreference
): Promise<boolean> {
  if (!hasSyncStorage()) {
    return false;
  }

  try {
    await chrome.storage.sync.set({
      [THEME_STORAGE_KEY]: preference,
    });
    return true;
  } catch {
    return false;
  }
}

export function subscribeToThemePreferenceChanges(
  callback: (preference: ThemePreference) => void
): () => void {
  let storageChanges: typeof chrome.storage.onChanged | undefined;

  try {
    if (typeof chrome === "undefined") {
      return () => undefined;
    }

    storageChanges = chrome.storage?.onChanged;
  } catch {
    return () => undefined;
  }

  if (!storageChanges) {
    return () => undefined;
  }

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    const themeChange = changes[THEME_STORAGE_KEY];

    if (areaName === "sync" && themeChange) {
      callback(normalizeThemePreference(themeChange.newValue));
    }
  };

  try {
    storageChanges.addListener(listener);
  } catch {
    return () => undefined;
  }

  return () => {
    try {
      storageChanges?.removeListener(listener);
    } catch {
      // Storage can disappear while an extension document is closing.
    }
  };
}
