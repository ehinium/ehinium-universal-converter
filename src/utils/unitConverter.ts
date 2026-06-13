import {
  unitDefinitions,
  type UnitCategory,
  type UnitCode,
} from "./unitTypes";
import type { UnitSystem } from "../types/settings";

const unitCategory = new Map<UnitCode, UnitCategory>(
  unitDefinitions.map((definition) => [definition.code, definition.category])
);

const lengthInMeters: Readonly<Record<Extract<UnitCode, "mm" | "cm" | "m" | "km" | "in" | "ft" | "yd" | "mi">, number>> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
};

const weightInGrams: Readonly<Record<Extract<UnitCode, "mg" | "g" | "kg" | "oz" | "lb">, number>> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

const defaultTargets: Readonly<Partial<Record<UnitCode, UnitCode>>> = {
  kg: "lb",
  g: "oz",
  lb: "kg",
  oz: "g",
  cm: "in",
  m: "ft",
  km: "mi",
  mi: "km",
  c: "f",
  f: "c",
};

const metricTargets: Readonly<Partial<Record<UnitCode, UnitCode>>> = {
  in: "cm",
  ft: "m",
  yd: "m",
  mi: "km",
  oz: "g",
  lb: "kg",
  f: "c",
};

const imperialTargets: Readonly<Partial<Record<UnitCode, UnitCode>>> = {
  mm: "in",
  cm: "in",
  m: "ft",
  km: "mi",
  mg: "oz",
  g: "oz",
  kg: "lb",
  c: "f",
};

function convertTemperature(
  amount: number,
  fromUnit: UnitCode,
  toUnit: UnitCode
): number | null {
  if (fromUnit === "c" && toUnit === "f") {
    return amount * 9 / 5 + 32;
  }

  if (fromUnit === "f" && toUnit === "c") {
    return (amount - 32) * 5 / 9;
  }

  return null;
}

export function convertUnit(
  amount: number,
  fromUnit: UnitCode,
  toUnit: UnitCode
): number | null {
  if (!Number.isFinite(amount)) {
    return null;
  }

  if (fromUnit === toUnit) {
    return amount;
  }

  const category = unitCategory.get(fromUnit);

  if (!category || category !== unitCategory.get(toUnit)) {
    return null;
  }

  if (category === "temperature") {
    return convertTemperature(amount, fromUnit, toUnit);
  }

  const factors = category === "length" ? lengthInMeters : weightInGrams;
  const fromFactor = factors[fromUnit as keyof typeof factors];
  const toFactor = factors[toUnit as keyof typeof factors];

  return fromFactor && toFactor ? amount * fromFactor / toFactor : null;
}

export function getDefaultTargetUnit(unit: UnitCode): UnitCode | null {
  return defaultTargets[unit] ?? null;
}

export function resolveTargetUnit(
  unit: UnitCode,
  unitSystem: UnitSystem,
  exactTarget: UnitCode | "auto"
): UnitCode | null {
  if (exactTarget !== "auto") {
    return exactTarget;
  }

  if (unitSystem === "metric") {
    return metricTargets[unit] ?? null;
  }

  if (unitSystem === "imperial") {
    return imperialTargets[unit] ?? null;
  }

  return getDefaultTargetUnit(unit);
}
