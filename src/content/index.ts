import { getSettings } from "../services/settings";
import { getExchangeRates } from "../services/rates";
import { convertCurrency } from "../utils/currencyConverter";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";

async function run() {
  console.log("Ehinium Universal Converter content script loaded.");

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

  console.log("Text nodes scanned:", textNodes.length);
  console.log("Conversions rendered:", renderedCount);
}

run();