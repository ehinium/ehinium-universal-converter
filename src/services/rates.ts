import type { NormalizedRatesResponse } from "../types/rates";
import { getFawazRates } from "./fawaz";
import { getFrankfurterRates } from "./frankfurter";
import { getErrorMessage } from "./rateUtils";

export async function getExchangeRates(
  baseCurrency: string
): Promise<NormalizedRatesResponse> {
  try {
    return await getFrankfurterRates(baseCurrency);
  } catch (frankfurterError) {
    try {
      return await getFawazRates(baseCurrency);
    } catch (fawazError) {
      throw new Error(
        `All exchange-rate providers failed. Frankfurter: ${getErrorMessage(
          frankfurterError
        )}. Fawaz: ${getErrorMessage(fawazError)}.`,
        { cause: fawazError }
      );
    }
  }
}
