import type { ExtensionMessage } from "../shared/messages";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[EUC] Background service worker installed");
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[EUC] Background service worker started");
});

function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const type = (message as Record<string, unknown>).type;
  return type === "PING" || type === "GET_SETTINGS";
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) {
    return false;
  }

  switch (message.type) {
    case "PING":
      sendResponse({ ok: true });
      return false;
    case "GET_SETTINGS":
      return false;
  }
});
