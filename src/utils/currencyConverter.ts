import type { ExchangeRates } from "../types/rates";

export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRates
): number | null {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const rate = rates[fromCurrency];

  if (!rate) {
    return null;
  }

  return amount / rate;
}
