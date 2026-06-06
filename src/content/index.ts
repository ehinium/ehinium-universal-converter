import { getSettings } from "../services/settings";
import { getExchangeRates } from "../services/rates";
import { convertCurrency } from "../utils/currencyConverter";
import { parseCurrencies } from "../utils/currencyParser";
import { getTextNodes } from "./domScanner";

async function run() {
  console.log("Ehinium Universal Converter content script loaded.");

  const settings = await getSettings();

  if (!settings.enabled) {
    console.log("Ehinium Universal Converter is disabled.");
    return;
  }

  const textNodes = getTextNodes(document.body);

  const matches = textNodes.flatMap((node) =>
    parseCurrencies(node.textContent ?? "")
  );

  const normalizedRates = await getExchangeRates(settings.targetCurrency);

  const convertedMatches = matches.map((match) => {
    const convertedAmount = convertCurrency(
      match.amount,
      match.currency,
      settings.targetCurrency,
      normalizedRates.rates
    );

    return {
      ...match,
      convertedAmount,
      targetCurrency: settings.targetCurrency,
    };
  });

  console.log("Text nodes scanned:", textNodes.length);
  console.log("Currency matches:", convertedMatches);
}

run();
