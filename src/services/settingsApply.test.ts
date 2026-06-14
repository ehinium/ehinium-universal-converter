import {
  formatSettingsApplyStatus,
  notifyActiveTabSettingsChanged,
} from "./settingsApply";

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

let sentTabId: number | null = null;
let sentType = "";

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    tabs: {
      query: async () => [{ id: 42 }],
      sendMessage: async (tabId: number, message: { type?: unknown }) => {
        sentTabId = tabId;
        sentType = String(message.type);
      },
    },
  },
});

expectEqual(
  await notifyActiveTabSettingsChanged(),
  true,
  "available content script"
);
expectEqual(sentTabId, 42, "settings change tab id");
expectEqual(sentType, "settings:changed", "settings change message type");

Object.defineProperty(chrome.tabs, "sendMessage", {
  configurable: true,
  value: async () => {
    throw new Error("Receiving end does not exist");
  },
});

expectEqual(
  await notifyActiveTabSettingsChanged(),
  false,
  "unavailable content script"
);
expectEqual(
  formatSettingsApplyStatus(false, true),
  "Reload this page to apply changes",
  "failed message reload notice"
);
