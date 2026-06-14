import type { ExtensionMessage } from "../shared/messages";

export function formatSettingsApplyStatus(
  isSaving: boolean,
  requiresReload: boolean
): string {
  if (isSaving) {
    return "Saving settings...";
  }

  return requiresReload
    ? "Reload this page to apply changes"
    : "Settings saved automatically.";
}

export async function notifyActiveTabSettingsChanged(): Promise<boolean> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab?.id === undefined) {
      return false;
    }

    await chrome.tabs.sendMessage(tab.id, {
      type: "settings:changed",
    } satisfies ExtensionMessage);
    return true;
  } catch {
    return false;
  }
}
