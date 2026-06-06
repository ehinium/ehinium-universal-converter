import { fiatCurrencies } from "../data/currencies";
import type { ExchangeRates } from "../types/rates";

const fiatCurrencyCodes = new Set(
  fiatCurrencies.map((currency) => currency.code)
);

export function normalizeBaseCurrency(baseCurrency: string): string {
  const normalized = baseCurrency.trim().toUpperCase();

  if (!fiatCurrencyCodes.has(normalized)) {
    throw new Error(`Unsupported fiat base currency: "${baseCurrency}"`);
  }

  return normalized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function filterFiatRates(
  values: Record<string, unknown>,
  baseCurrency: string
): ExchangeRates {
  const rates: ExchangeRates = { [baseCurrency]: 1 };

  for (const [code, value] of Object.entries(values)) {
    const normalizedCode = code.toUpperCase();

    if (fiatCurrencyCodes.has(normalizedCode) && isValidRate(value)) {
      rates[normalizedCode] = value;
    }
  }

  return rates;
}

export function hasRates(rates: ExchangeRates): boolean {
  return Object.keys(rates).length > 1;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchJson(
  url: string,
  providerName: string
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `${providerName} request failed: ${getErrorMessage(error)}`,
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new Error(
      `${providerName} request failed with HTTP ${response.status} ${response.statusText}`.trim()
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${providerName} response was not valid JSON`, {
      cause: error,
    });
  }
}
