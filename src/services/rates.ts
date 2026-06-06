import type { NormalizedRatesResponse } from "../types/rates";
import { getFawazRates } from "./fawaz";
import { getFrankfurterRates } from "./frankfurter";
import { getErrorMessage, normalizeBaseCurrency } from "./rateUtils";

const CACHE_TTL_MS = 30 * 60 * 1000;

type CachedRates = {
  response: NormalizedRatesResponse;
  expiresAt: number;
};

const ratesCache = new Map<string, CachedRates>();

export async function getExchangeRates(
  baseCurrency: string
): Promise<NormalizedRatesResponse> {
  const base = normalizeBaseCurrency(baseCurrency);
  const cached = ratesCache.get(base);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  ratesCache.delete(base);

  let response: NormalizedRatesResponse;

  try {
    response = await getFrankfurterRates(base);
  } catch (frankfurterError) {
    try {
      response = await getFawazRates(base);
    } catch (fawazError) {
      throw new Error(
        `All exchange-rate providers failed. Frankfurter: ${getErrorMessage(
          frankfurterError
        )}. Fawaz: ${getErrorMessage(fawazError)}.`,
        { cause: fawazError }
      );
    }
  }

  ratesCache.set(base, {
    response,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return response;
}
