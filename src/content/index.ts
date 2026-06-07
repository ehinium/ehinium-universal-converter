import {
  getSettings,
  subscribeToSettingsChanges,
} from "../services/settings";
import { isDomainAllowed } from "../services/domainRules";
import { getExchangeRates } from "../services/rates";
import type { UserSettings } from "../types/settings";
import { convertCurrency } from "../utils/currencyConverter";
import { getTextNodes } from "./domScanner";
import {
  renderConversions,
  resetRenderedConversions,
} from "./domRenderer";
import { observeDomChanges } from "./observer";

let currentSettings: UserSettings | null = null;
let isProcessing = false;
let conversionRequested = false;
let settingsVersion = 0;
let stopObserver: (() => void) | null = null;

const hostname = window.location.hostname;

function domainIsAllowed(settings: UserSettings | null): boolean {
  return settings !== null && isDomainAllowed(hostname, settings);
}

function startObserver(): void {
  if (stopObserver || !domainIsAllowed(currentSettings)) {
    return;
  }

  stopObserver = observeDomChanges(() => {
    if (currentSettings?.enabled && domainIsAllowed(currentSettings)) {
      requestConversion();
    }
  });
}

function stopObserving(): void {
  stopObserver?.();
  stopObserver = null;
}

async function processConversions(): Promise<void> {
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  try {
    while (conversionRequested) {
      conversionRequested = false;

      const settings = currentSettings;
      const version = settingsVersion;

      if (!settings?.enabled || !domainIsAllowed(settings)) {
        continue;
      }

      const ratesData = await getExchangeRates(settings.targetCurrency);

      if (
        version !== settingsVersion ||
        !currentSettings?.enabled ||
        !domainIsAllowed(currentSettings) ||
        currentSettings.targetCurrency !== settings.targetCurrency
      ) {
        continue;
      }

      const renderedCount = renderConversions(getTextNodes(document.body), {
        targetCurrency: settings.targetCurrency,
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
    }
  } finally {
    isProcessing = false;

    if (conversionRequested) {
      void processConversions().catch(() => undefined);
    }
  }
}

function requestConversion(): void {
  conversionRequested = true;
  void processConversions().catch(() => undefined);
}

function handleSettingsChange(settings: UserSettings): void {
  const previousSettings = currentSettings;
  const targetCurrencyChanged =
    previousSettings?.targetCurrency !== settings.targetCurrency;
  const enabledChanged = previousSettings?.enabled !== settings.enabled;
  const wasDomainAllowed = domainIsAllowed(previousSettings);
  const domainAllowed = isDomainAllowed(hostname, settings);

  currentSettings = settings;

  if (
    !targetCurrencyChanged &&
    !enabledChanged &&
    wasDomainAllowed === domainAllowed
  ) {
    return;
  }

  settingsVersion++;

  if (!domainAllowed) {
    conversionRequested = false;
    stopObserving();

    if (wasDomainAllowed) {
      console.log("[EUC] Domain blocked:", hostname);
    }

    return;
  }

  if (targetCurrencyChanged || !wasDomainAllowed) {
    resetRenderedConversions(document);
  }

  startObserver();

  if (settings.enabled) {
    requestConversion();
  }
}

async function run(): Promise<void> {
  console.log("[EUC] Content script loaded");

  currentSettings = await getSettings();
  subscribeToSettingsChanges(handleSettingsChange);

  if (!domainIsAllowed(currentSettings)) {
    console.log("[EUC] Domain blocked:", hostname);
    return;
  }

  conversionRequested = true;

  try {
    await processConversions();
  } finally {
    startObserver();
  }
}

void run().catch(() => undefined);
