import type { NormalizedRatesResponse } from "../types/rates";
import { mergeRateResponses } from "./rates";

const primary: NormalizedRatesResponse = {
  base: "USD",
  date: "2026-07-16",
  provider: "frankfurter",
  rates: { USD: 1, EUR: 0.86 },
};
const fallback: NormalizedRatesResponse = {
  base: "USD",
  date: "2026-07-14",
  provider: "fawaz",
  rates: { USD: 1, EUR: 0.85, VED: 722.75 },
};
const merged = mergeRateResponses(primary, fallback);

if (
  merged.provider !== "frankfurter+fawaz" ||
  merged.date !== "2026-07-14" ||
  merged.rates.EUR !== 0.86 ||
  merged.rates.VED !== 722.75
) {
  throw new Error(`Unexpected merged rate response: ${JSON.stringify(merged)}`);
}

let baseMismatchRejected = false;
try {
  mergeRateResponses(primary, { ...fallback, base: "EUR" });
} catch {
  baseMismatchRejected = true;
}

if (!baseMismatchRejected) {
  throw new Error("Merging different rate bases must fail");
}

console.log("Partial primary rates are supplemented by fallback rates.");
