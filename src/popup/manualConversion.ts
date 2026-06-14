import { parseCurrencies } from "../utils/currencyParser";
import {
  formatSourceCurrency,
  formatSourceUnit,
} from "../utils/displayFormatting";
import { parseUnits } from "../utils/unitParser";

function isFullInputMatch(raw: string, input: string): boolean {
  return raw.trim() === input.trim();
}

export function formatManualConversionInput(value: string): string {
  const currencyMatches = parseCurrencies(value).filter((match) =>
    isFullInputMatch(match.raw, value)
  );
  const unitMatches = parseUnits(value).filter((match) =>
    isFullInputMatch(match.raw, value)
  );

  if (currencyMatches.length + unitMatches.length !== 1) {
    return value;
  }

  const currencyMatch = currencyMatches[0];

  if (currencyMatch) {
    return formatSourceCurrency(currencyMatch.amount, currencyMatch.currency);
  }

  const unitMatch = unitMatches[0];
  return unitMatch ? formatSourceUnit(unitMatch.amount, unitMatch.unit) : value;
}

export async function copyManualConversion(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
