import {
  getSettings,
  subscribeToSettingsChanges,
} from "../services/settings";
import { isDomainAllowed } from "../services/domainRules";
import { getExchangeRates } from "../services/rates";
import type { UserSettings } from "../types/settings";
import type { ExtensionMessage } from "../shared/messages";
import { convertCurrency } from "../utils/currencyConverter";
import {
  clearDebugEvents,
  debugLog,
  getDebugEvents,
  isDebugEnabled,
  type DebugEvent,
} from "./debug";
import {
  renderConversions,
  resetRenderedConversions,
} from "./domRenderer";
import { getClosestHoverTarget } from "./hoverRegistry";
import { observeDomChanges } from "./observer";
import { hideTooltip, showTooltip } from "./tooltip";
import { refreshContentSettings } from "./settingsRefresh";
import {
  createScanScheduler,
  type ScanRequest,
} from "./scanScheduler";
import { collectTextNodesForScan } from "./scanRoots";

declare global {
  interface Window {
    __EUC_DEBUG__?: {
      getEvents: () => DebugEvent[];
      clear: () => void;
    };
  }
}

let currentSettings: UserSettings | null = null;
let settingsVersion = 0;
let stopObserver: (() => void) | null = null;
let hoverListenersRegistered = false;
let messageListenerRegistered = false;

const hostname = window.location.hostname;
const SCAN_DEBOUNCE_DELAY_MS = 125;

function getErrorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logDebugError(error: unknown): void {
  debugLog({
    type: "error",
    reason: getErrorReason(error),
  });
}

function exposeDebugHelper(): void {
  if (!isDebugEnabled()) {
    return;
  }

  try {
    Object.defineProperty(window, "__EUC_DEBUG__", {
      configurable: true,
      value: Object.freeze({
        getEvents: getDebugEvents,
        clear: clearDebugEvents,
      }),
    });
  } catch (error) {
    logDebugError(error);
  }
}

function domainIsAllowed(settings: UserSettings | null): boolean {
  return settings !== null && isDomainAllowed(hostname, settings);
}

function startObserver(): void {
  if (
    stopObserver ||
    !currentSettings?.enabled ||
    !domainIsAllowed(currentSettings)
  ) {
    return;
  }

  stopObserver = observeDomChanges((roots) => {
    if (currentSettings?.enabled && domainIsAllowed(currentSettings)) {
      scanScheduler.schedule({
        reason: "mutation",
        roots,
      });
    }
  });
}

function stopObserving(): void {
  stopObserver?.();
  stopObserver = null;
}

function registerHoverListeners(): void {
  if (hoverListenersRegistered) {
    return;
  }

  document.addEventListener("mousemove", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      hideTooltip();
      return;
    }

    const hoverTarget = getClosestHoverTarget(target);

    if (hoverTarget) {
      showTooltip(event.clientX, event.clientY, hoverTarget.content);
    } else {
      hideTooltip();
    }
  });

  document.addEventListener("mouseleave", hideTooltip);
  hoverListenersRegistered = true;
}

async function copyText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through to the temporary textarea fallback.
  }

  const textarea = document.createElement("textarea");

  textarea.value = value;
  textarea.setAttribute("data-ehinium-ignore", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function showManualConversionToast(formatted: string): void {
  const toast = document.createElement("div");

  toast.setAttribute("data-ehinium-ignore", "true");
  toast.textContent = `Converted and copied: ${formatted}`;
  toast.style.position = "fixed";
  toast.style.right = "16px";
  toast.style.bottom = "16px";
  toast.style.zIndex = "2147483647";
  toast.style.padding = "9px 12px";
  toast.style.borderRadius = "8px";
  toast.style.background = "rgba(24, 29, 38, 0.96)";
  toast.style.color = "#ffffff";
  toast.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.22)";
  toast.style.font =
    '12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  toast.style.pointerEvents = "none";
  document.documentElement.append(toast);

  setTimeout(() => {
    toast.remove();
  }, 1800);
}

async function applySettingsFromMessage(): Promise<void> {
  await refreshContentSettings({
    clear() {
      settingsVersion++;
      scanScheduler.cancel();
      stopObserving();
      resetRenderedConversions(document);
      hideTooltip();
    },
    load: getSettings,
    apply(settings) {
      currentSettings = settings;
    },
    async rescan() {
      if (!currentSettings?.enabled || !domainIsAllowed(currentSettings)) {
        return;
      }

      registerHoverListeners();
      await scanScheduler.flush({
        reason: "settings",
        roots: null,
      });
      startObserver();
    },
  });
}

function registerMessageListener(): void {
  if (messageListenerRegistered) {
    return;
  }

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    ) {
      return false;
    }

    if ((message as Partial<ExtensionMessage>).type === "settings:changed") {
      void applySettingsFromMessage().catch(logDebugError);
      return false;
    }

    if ((message as Partial<ExtensionMessage>).type !== "SHOW_MANUAL_CONVERSION") {
      return false;
    }

    const formatted = (message as Partial<ExtensionMessage> & {
      formatted?: unknown;
    }).formatted;

    if (typeof formatted !== "string") {
      return false;
    }

    void copyText(formatted)
      .then(() => {
        showManualConversionToast(formatted);
      })
      .catch(logDebugError);
    return false;
  });

  messageListenerRegistered = true;
}

function settingsChangedDuringScan(
  settings: UserSettings,
  version: number
): boolean {
  return (
    version !== settingsVersion ||
    !currentSettings?.enabled ||
    !domainIsAllowed(currentSettings) ||
    currentSettings.targetCurrency !== settings.targetCurrency ||
    currentSettings.converterMode !== settings.converterMode ||
    currentSettings.badgeStyle !== settings.badgeStyle ||
    currentSettings.badgeVisibility !== settings.badgeVisibility ||
    currentSettings.unitSystem !== settings.unitSystem ||
    currentSettings.targetLengthUnit !== settings.targetLengthUnit ||
    currentSettings.targetWeightUnit !== settings.targetWeightUnit ||
    currentSettings.targetTemperatureUnit !== settings.targetTemperatureUnit
  );
}

async function scanConversions(request: ScanRequest): Promise<number> {
  const settings = currentSettings;
  const version = settingsVersion;

  if (!settings?.enabled || !domainIsAllowed(settings)) {
    debugLog({
      type: "scan:skipped",
      reason: "Conversions disabled or domain blocked",
    });
    return 0;
  }

  const roots = request.roots ?? [document.body];
  const textNodes = await collectTextNodesForScan(roots);

  if (textNodes.length === 0) {
    debugLog({
      type: "scan:skipped",
      reason: "No eligible text nodes",
      scannedNodeCount: 0,
    });
    return 0;
  }

  if (settings.converterMode === "units") {
    const renderedCount = renderConversions(textNodes, {
      enabled: settings.enabled,
      targetCurrency: settings.targetCurrency,
      converterMode: settings.converterMode,
      badgeStyle: settings.badgeStyle,
      badgeVisibility: settings.badgeVisibility,
      unitSystem: settings.unitSystem,
      targetLengthUnit: settings.targetLengthUnit,
      targetWeightUnit: settings.targetWeightUnit,
      targetTemperatureUnit: settings.targetTemperatureUnit,
      convertAmount: () => null,
    });

    if (renderedCount > 0) {
      console.log("[EUC] Conversions rendered:", renderedCount);
    }

    return textNodes.length;
  }

  const ratesData = await getExchangeRates(settings.targetCurrency);

  if (settingsChangedDuringScan(settings, version)) {
    debugLog({
      type: "scan:skipped",
      reason: "Settings changed before render",
      scannedNodeCount: textNodes.length,
    });
    return textNodes.length;
  }

  const renderedCount = renderConversions(textNodes, {
    enabled: settings.enabled,
    targetCurrency: settings.targetCurrency,
    converterMode: settings.converterMode,
    badgeStyle: settings.badgeStyle,
    badgeVisibility: settings.badgeVisibility,
    unitSystem: settings.unitSystem,
    targetLengthUnit: settings.targetLengthUnit,
    targetWeightUnit: settings.targetWeightUnit,
    targetTemperatureUnit: settings.targetTemperatureUnit,
    convertAmount(match) {
      return convertCurrency(
        match.amount,
        match.currency,
        settings.targetCurrency,
        ratesData.rates
      );
    },
  });

  if (renderedCount > 0) {
    console.log("[EUC] Conversions rendered:", renderedCount);
  }

  return textNodes.length;
}

const scanScheduler = createScanScheduler({
  delayMs: SCAN_DEBOUNCE_DELAY_MS,
  scan: scanConversions,
  debugLog,
});

function handleSettingsChange(settings: UserSettings): void {
  const previousSettings = currentSettings;
  const targetCurrencyChanged =
    previousSettings?.targetCurrency !== settings.targetCurrency;
  const enabledChanged = previousSettings?.enabled !== settings.enabled;
  const converterModeChanged =
    previousSettings?.converterMode !== settings.converterMode;
  const badgeStyleChanged = previousSettings?.badgeStyle !== settings.badgeStyle;
  const badgeVisibilityChanged =
    previousSettings?.badgeVisibility !== settings.badgeVisibility;
  const unitPreferencesChanged =
    previousSettings?.unitSystem !== settings.unitSystem ||
    previousSettings?.targetLengthUnit !== settings.targetLengthUnit ||
    previousSettings?.targetWeightUnit !== settings.targetWeightUnit ||
    previousSettings?.targetTemperatureUnit !== settings.targetTemperatureUnit;
  const wasDomainAllowed = domainIsAllowed(previousSettings);
  const domainAllowed = isDomainAllowed(hostname, settings);

  currentSettings = settings;

  if (
    !targetCurrencyChanged &&
    !enabledChanged &&
    !converterModeChanged &&
    !badgeStyleChanged &&
    !badgeVisibilityChanged &&
    !unitPreferencesChanged &&
    wasDomainAllowed === domainAllowed
  ) {
    return;
  }

  settingsVersion++;

  if (!settings.enabled) {
    scanScheduler.cancel();
    stopObserving();
    resetRenderedConversions(document);
    return;
  }

  if (!domainAllowed) {
    scanScheduler.cancel();
    stopObserving();
    resetRenderedConversions(document);

    if (wasDomainAllowed) {
      console.log("[EUC] Domain blocked:", hostname);
    }

    return;
  }

  if (
    targetCurrencyChanged ||
    converterModeChanged ||
    badgeStyleChanged ||
    badgeVisibilityChanged ||
    unitPreferencesChanged ||
    !wasDomainAllowed
  ) {
    resetRenderedConversions(document);
  }

  startObserver();
  scanScheduler.schedule({
    reason: "settings",
    roots: null,
  });
}

async function run(): Promise<void> {
  exposeDebugHelper();
  registerMessageListener();
  console.log("[EUC] Content script loaded");

  currentSettings = await getSettings();
  subscribeToSettingsChanges(handleSettingsChange);

  if (!domainIsAllowed(currentSettings)) {
    console.log("[EUC] Domain blocked:", hostname);
    return;
  }

  registerHoverListeners();

  try {
    await scanScheduler.flush({
      reason: "initial",
      roots: null,
    });
  } finally {
    startObserver();
  }
}

void run().catch(logDebugError);
