import { getSettings } from "../services/settings";
import { getExchangeRates } from "../services/rates";
import { convertCurrency } from "../utils/currencyConverter";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";
import { observeDomChanges } from "./observer";

let isProcessing = false;

async function runConversion(): Promise<void> {
  if (isProcessing) {
    return;
  }

  isProcessing = true;

  try {
    const settings = await getSettings();

    if (!settings.enabled) {
      return;
    }

    const textNodes = getTextNodes(document.body);
    const ratesData = await getExchangeRates(settings.targetCurrency);

    const renderedCount = renderConversions(textNodes, {
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
  } finally {
    isProcessing = false;
  }
}

async function run(): Promise<void> {
  console.log("[EUC] Content script loaded");

  try {
    await runConversion();
  } finally {
    observeDomChanges(() => {
      void runConversion().catch(() => undefined);
    });
  }
}

void run().catch(() => undefined);
