import type { NormalizedRatesResponse } from "../types/rates";
import {
  filterFiatRates,
  fetchJson,
  hasRates,
  isRecord,
  isValidRate,
  normalizeBaseCurrency,
} from "./rateUtils";

const FRANKFURTER_RATES_URL = "https://api.frankfurter.dev/v2/rates";

type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

function isFrankfurterRate(value: unknown): value is FrankfurterRate {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    typeof value.base === "string" &&
    typeof value.quote === "string" &&
    isValidRate(value.rate)
  );
}

export async function getFrankfurterRates(
  baseCurrency: string
): Promise<NormalizedRatesResponse> {
  const base = normalizeBaseCurrency(baseCurrency);
  const data = await fetchJson(
    `${FRANKFURTER_RATES_URL}?base=${encodeURIComponent(base)}`,
    "Frankfurter"
  );

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Frankfurter response did not contain a rates array");
  }

  if (!data.every(isFrankfurterRate)) {
    throw new Error("Frankfurter response contained an invalid rate entry");
  }

  const rateValues: Record<string, unknown> = {};
  let date = "";

  for (const entry of data) {
    if (entry.base.toUpperCase() !== base) {
      throw new Error(
        `Frankfurter response base "${entry.base}" did not match requested base "${base}"`
      );
    }

    rateValues[entry.quote] = entry.rate;

    if (entry.date > date) {
      date = entry.date;
    }
  }

  const rates = filterFiatRates(rateValues, base);

  if (!hasRates(rates)) {
    throw new Error("Frankfurter response did not contain a valid rates object");
  }

  return {
    base,
    date,
    rates,
    provider: "frankfurter",
  };
}
