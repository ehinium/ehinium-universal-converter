import type { UnitCode } from "./unitTypes";

const readableNumberOptions: Intl.NumberFormatOptions = { maximumFractionDigits: 6 };
const numberFormatters = new Map<string, Intl.NumberFormat>();

// Building an Intl.NumberFormat costs far more than formatting with one, and a
// page formats hundreds of badges with a handful of option sets. The first one
// also loads the locale data, so none is built before a page has something to show.
function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

function getCurrencyFractionDigits(amount: number): {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
} {
  const absoluteAmount = Math.abs(amount);

  if (absoluteAmount >= 1) {
    return {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    };
  }

  if (absoluteAmount >= 0.01) {
    return {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    };
  }

  return {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  };
}

function getUnitMaximumFractionDigits(amount: number): number {
  return Math.abs(amount) > 0 && Math.abs(amount) < 0.01 ? 4 : 2;
}

export function formatReadableNumber(amount: number): string {
  return numberFormat(readableNumberOptions).format(amount);
}

const unitLabels: Partial<Record<UnitCode, string>> = {
  c: "°C",
  f: "°F",
  floz: "fl oz",
  l: "L",
};

export function formatUnitLabel(unit: UnitCode): string {
  return unitLabels[unit] ?? unit;
}

/** How several amounts of one unit are joined: dimensions `60 × 84`, ranges `30–49`. */
export type UnitAmountJoiner = "dimension" | "range";

function joinAmounts(amounts: readonly string[], joiner: UnitAmountJoiner): string {
  return amounts.join(joiner === "range" ? "–" : " × ");
}

export function formatSourceCurrency(amount: number, currency: string): string {
  return `${formatReadableNumber(amount)} ${currency.toUpperCase()}`;
}

/** Accepts one amount or the amounts of a dimension such as `60 × 84`. */
export function formatSourceUnit(
  amount: number | readonly number[],
  unit: UnitCode,
  joiner: UnitAmountJoiner = "dimension"
): string {
  const amounts = typeof amount === "number" ? [amount] : amount;
  return `${joinAmounts(amounts.map(formatReadableNumber), joiner)} ${formatUnitLabel(unit)}`;
}

export function formatConvertedCurrency(
  amount: number,
  currency: string
): string {
  const normalizedCurrency = currency.toUpperCase();

  if (normalizedCurrency === "IRT" || normalizedCurrency === "IRR") {
    const tomanAmount = normalizedCurrency === "IRR" ? amount / 10 : amount;
    const formattedAmount = numberFormat({
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(tomanAmount);

    return `${formattedAmount} IRT`;
  }

  try {
    return numberFormat({
      style: "currency",
      currency: normalizedCurrency,
      ...getCurrencyFractionDigits(amount),
    }).format(amount);
  } catch {
    const formattedAmount = numberFormat({
      ...getCurrencyFractionDigits(amount),
    }).format(amount);

    return `${normalizedCurrency} ${formattedAmount}`;
  }
}

/** Accepts one amount or the amounts of a dimension such as `152.4 × 213.36`. */
export function formatConvertedUnit(
  amount: number | readonly number[],
  unit: UnitCode,
  joiner: UnitAmountJoiner = "dimension"
): string {
  const amounts = typeof amount === "number" ? [amount] : amount;
  const formattedAmounts = amounts.map((value) =>
    numberFormat({
      maximumFractionDigits: getUnitMaximumFractionDigits(value),
    }).format(value)
  );

  return `${joinAmounts(formattedAmounts, joiner)} ${formatUnitLabel(unit)}`;
}
