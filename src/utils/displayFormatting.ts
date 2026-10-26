import type { UnitCode } from "./unitTypes";

const readableNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

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
  return readableNumberFormatter.format(amount);
}

export function formatUnitLabel(unit: UnitCode): string {
  return unit === "c" ? "°C" : unit === "f" ? "°F" : unit;
}

export function formatSourceCurrency(amount: number, currency: string): string {
  return `${formatReadableNumber(amount)} ${currency.toUpperCase()}`;
}

/** Accepts one amount or the amounts of a dimension such as `60 × 84`. */
export function formatSourceUnit(
  amount: number | readonly number[],
  unit: UnitCode
): string {
  const amounts = typeof amount === "number" ? [amount] : amount;
  return `${amounts.map(formatReadableNumber).join(" × ")} ${formatUnitLabel(unit)}`;
}

export function formatConvertedCurrency(
  amount: number,
  currency: string
): string {
  const normalizedCurrency = currency.toUpperCase();

  if (normalizedCurrency === "IRT" || normalizedCurrency === "IRR") {
    const tomanAmount = normalizedCurrency === "IRR" ? amount / 10 : amount;
    const formattedAmount = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(tomanAmount);

    return `${formattedAmount} IRT`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      ...getCurrencyFractionDigits(amount),
    }).format(amount);
  } catch {
    const formattedAmount = new Intl.NumberFormat("en-US", {
      ...getCurrencyFractionDigits(amount),
    }).format(amount);

    return `${normalizedCurrency} ${formattedAmount}`;
  }
}

/** Accepts one amount or the amounts of a dimension such as `152.4 × 213.36`. */
export function formatConvertedUnit(
  amount: number | readonly number[],
  unit: UnitCode
): string {
  const amounts = typeof amount === "number" ? [amount] : amount;
  const formattedAmounts = amounts.map((value) =>
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: getUnitMaximumFractionDigits(value),
    }).format(value)
  );

  return `${formattedAmounts.join(" × ")} ${formatUnitLabel(unit)}`;
}
