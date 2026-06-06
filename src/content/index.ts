import {
  getSettings,
  subscribeToSettingsChanges,
} from "../services/settings";
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

      if (!settings?.enabled) {
        continue;
      }

      const ratesData = await getExchangeRates(settings.targetCurrency);

      if (
        version !== settingsVersion ||
        !currentSettings?.enabled ||
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

  currentSettings = settings;

  if (!targetCurrencyChanged && !enabledChanged) {
    return;
  }

  settingsVersion++;

  if (targetCurrencyChanged) {
    resetRenderedConversions(document);
  }

  if (settings.enabled) {
    requestConversion();
  }
}

async function run(): Promise<void> {
  console.log("[EUC] Content script loaded");

  currentSettings = await getSettings();
  subscribeToSettingsChanges(handleSettingsChange);

  conversionRequested = true;

  try {
    await processConversions();
  } finally {
    observeDomChanges(() => {
      if (currentSettings?.enabled) {
        requestConversion();
      }
    });
  }
}

void run().catch(() => undefined);
