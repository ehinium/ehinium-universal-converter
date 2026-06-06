import { convertCurrency } from "../utils/currencyConverter";
import { parseCurrencies } from "../utils/currencyParser";
import { getRates } from "../services/frankfurter";

async function run() {
  console.log("Ehinium Universal Converter content script loaded.");

  const text = document.body.innerText;
  const matches = parseCurrencies(text);

  const targetCurrency = "EUR";
  const ratesData = await getRates(targetCurrency);

  const convertedMatches = matches.map((match) => {
    const convertedAmount = convertCurrency(
      match.amount,
      match.currency,
      targetCurrency,
      ratesData.rates
    );

    return {
      ...match,
      convertedAmount,
      targetCurrency,
    };
  });

  console.log("Currency matches:", convertedMatches);
}

run();