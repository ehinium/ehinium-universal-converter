import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";

const STORAGE_KEY = "euc-settings";

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);

  return {
    ...defaultSettings,
    ...(result[STORAGE_KEY] ?? {}),
  };
}

export async function saveSettings(
  settings: UserSettings
): Promise<void> {
  await chrome.storage.sync.set({
    [STORAGE_KEY]: settings,
  });
}
