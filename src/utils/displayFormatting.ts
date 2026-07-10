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

export function formatSourceUnit(amount: number, unit: UnitCode): string {
  return `${formatReadableNumber(amount)} ${formatUnitLabel(unit)}`;
}

export function formatConvertedCurrency(
  amount: number,
  currency: string
): string {
  const normalizedCurrency = currency.toUpperCase();

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

export function formatConvertedUnit(amount: number, unit: UnitCode): string {
  const formattedAmount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: getUnitMaximumFractionDigits(amount),
  }).format(amount);

  return `${formattedAmount} ${formatUnitLabel(unit)}`;
}
