import type { UnitCode } from "./unitTypes";

const readableNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

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
