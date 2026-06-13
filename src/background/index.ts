import { getExchangeRates } from "../services/rates";
import {
  convertSelectedText,
  type SelectedTextConversionDependencies,
} from "../services/selectedTextConverter";
import { getSettings } from "../services/settings";
import type { ExtensionMessage } from "../shared/messages";

const CONTEXT_MENU_ID = "ehinium-convert-selection";
const CONTEXT_MENU_TITLE = "Convert with Ehinium Universal Converter";

const conversionDependencies: SelectedTextConversionDependencies = {
  async getRates(baseCurrency) {
    return (await getExchangeRates(baseCurrency)).rates;
  },
};

function createContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: CONTEXT_MENU_TITLE,
      contexts: ["selection"],
    });
  });
}

function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const type = (message as Record<string, unknown>).type;
  return (
    type === "PING" ||
    type === "GET_SETTINGS" ||
    type === "SHOW_MANUAL_CONVERSION"
  );
}

async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) {
    return;
  }

  try {
    const settings = await getSettings();
    const formatted = await convertSelectedText(
      info.selectionText,
      settings,
      conversionDependencies
    );

    if (!formatted || tab?.id === undefined) {
      return;
    }

    await chrome.tabs.sendMessage(tab.id, {
      type: "SHOW_MANUAL_CONVERSION",
      formatted,
    } satisfies ExtensionMessage);
  } catch {
    // Context-menu conversion should fail quietly on restricted pages or provider errors.
  }
}

chrome.runtime.onInstalled.addListener(createContextMenu);
chrome.runtime.onStartup.addListener(createContextMenu);
chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) {
    return false;
  }

  switch (message.type) {
    case "PING":
      sendResponse({ ok: true });
      return false;
    case "GET_SETTINGS":
    case "SHOW_MANUAL_CONVERSION":
      return false;
  }
});
