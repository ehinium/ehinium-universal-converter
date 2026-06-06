import type { NormalizedRatesResponse } from "../types/rates";
import {
  filterFiatRates,
  fetchJson,
  hasRates,
  isRecord,
  normalizeBaseCurrency,
} from "./rateUtils";

const FAWAZ_RATES_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";

export async function getFawazRates(
  baseCurrency: string
): Promise<NormalizedRatesResponse> {
  const base = normalizeBaseCurrency(baseCurrency);
  const baseKey = base.toLowerCase();
  const data = await fetchJson(
    `${FAWAZ_RATES_URL}/${encodeURIComponent(baseKey)}.json`,
    "Fawaz"
  );

  if (!isRecord(data)) {
    throw new Error("Fawaz response was not an object");
  }

  if (typeof data.date !== "string" || data.date.length === 0) {
    throw new Error("Fawaz response did not contain a valid date");
  }

  const rateValues = data[baseKey];

  if (!isRecord(rateValues)) {
    throw new Error(
      `Fawaz response did not contain a rates object for base "${base}"`
    );
  }

  const rates = filterFiatRates(rateValues, base);

  if (!hasRates(rates)) {
    throw new Error("Fawaz response did not contain a valid rates object");
  }

  return {
    base,
    date: data.date,
    rates,
    provider: "fawaz",
  };
}
