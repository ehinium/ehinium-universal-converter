export type ExchangeRates = Record<string, number>;

export type RateProviderName = "frankfurter" | "fawaz";

export type NormalizedRatesResponse = {
  base: string;
  date: string;
  rates: ExchangeRates;
  provider: RateProviderName;
};
