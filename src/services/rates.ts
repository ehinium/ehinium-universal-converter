import type { NormalizedRatesResponse } from "../types/rates";
import { fiatCurrencies } from "../data/currencies";
import { getFawazRates } from "./fawaz";
import { getFrankfurterRates } from "./frankfurter";
import { getErrorMessage, normalizeBaseCurrency } from "./rateUtils";

const CACHE_TTL_MS = 30 * 60 * 1000;

type CachedRates = {
  response: NormalizedRatesResponse;
  fetchedAt: number;
  expiresAt: number;
};

export type ExchangeRateStatus = {
  response: NormalizedRatesResponse | null;
  fetchedAt: number | null;
  lastErrorAt: number | null;
};

const ratesCache = new Map<string, CachedRates>();
const rateErrors = new Map<string, number>();

function hasEveryCanonicalFiatRate(response: NormalizedRatesResponse): boolean {
  return fiatCurrencies.every((currency) => response.rates[currency.code] !== undefined);
}

export function mergeRateResponses(
  primary: NormalizedRatesResponse,
  fallback: NormalizedRatesResponse
): NormalizedRatesResponse {
  if (primary.base !== fallback.base) {
    throw new Error(
      `Cannot merge rate responses with different bases: ${primary.base} and ${fallback.base}`
    );
  }

  return {
    base: primary.base,
    date: primary.date < fallback.date ? primary.date : fallback.date,
    rates: {
      ...fallback.rates,
      ...primary.rates,
    },
    provider: "frankfurter+fawaz",
  };
}

export async function getExchangeRates(
  baseCurrency: string,
  options: { forceRefresh?: boolean } = {}
): Promise<NormalizedRatesResponse> {
  const base = normalizeBaseCurrency(baseCurrency);
  const cached = ratesCache.get(base);

  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  let response: NormalizedRatesResponse;

  try {
    response = await getFrankfurterRates(base);

    if (!hasEveryCanonicalFiatRate(response)) {
      try {
        response = mergeRateResponses(response, await getFawazRates(base));
      } catch {
        // A partial primary response remains usable when supplemental fallback
        // rates fail; missing currencies stay explicit to the conversion path.
      }
    }
  } catch (frankfurterError) {
    try {
      response = await getFawazRates(base);
    } catch (fawazError) {
      rateErrors.set(base, Date.now());
      throw new Error(
        `All exchange-rate providers failed. Frankfurter: ${getErrorMessage(
          frankfurterError
        )}. Fawaz: ${getErrorMessage(fawazError)}.`,
        { cause: fawazError }
      );
    }
  }

  const fetchedAt = Date.now();

  ratesCache.set(base, {
    response,
    fetchedAt,
    expiresAt: fetchedAt + CACHE_TTL_MS,
  });
  rateErrors.delete(base);

  return response;
}

export function getExchangeRateStatus(baseCurrency: string): ExchangeRateStatus {
  const base = normalizeBaseCurrency(baseCurrency);
  const cached = ratesCache.get(base);

  return {
    response: cached?.response ?? null,
    fetchedAt: cached?.fetchedAt ?? null,
    lastErrorAt: rateErrors.get(base) ?? null,
  };
}

export function refreshExchangeRates(
  baseCurrency: string
): Promise<NormalizedRatesResponse> {
  return getExchangeRates(baseCurrency, { forceRefresh: true });
}
