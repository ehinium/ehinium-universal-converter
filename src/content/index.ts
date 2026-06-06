import { getSettings } from "../services/settings";
import { getRates } from "../services/frankfurter";
import { convertCurrency } from "../utils/currencyConverter";
import { parseCurrencies } from "../utils/currencyParser";

async function run() {
  console.log("Ehinium Universal Converter content script loaded.");

  const settings = await getSettings();

  if (!settings.enabled) {
    console.log("Ehinium Universal Converter is disabled.");
    return;
  }

  const text = document.body.innerText;
  const matches = parseCurrencies(text);

  const ratesData = await getRates(settings.targetCurrency);

  const convertedMatches = matches.map((match) => {
    const convertedAmount = convertCurrency(
      match.amount,
      match.currency,
      settings.targetCurrency,
      ratesData.rates
    );

    return {
      ...match,
      convertedAmount,
      targetCurrency: settings.targetCurrency,
    };
  });

  console.log("Currency matches:", convertedMatches);
}

run();