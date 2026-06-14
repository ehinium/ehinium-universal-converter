import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { convertCurrency } from "../utils/currencyConverter";
import { parseCurrencies } from "../utils/currencyParser";
import {
  formatSourceCurrency,
  formatSourceUnit,
  formatUnitLabel,
} from "../utils/displayFormatting";
import { convertUnit, resolveTargetUnit } from "../utils/unitConverter";
import { parseUnits } from "../utils/unitParser";
import type { UnitCode, UnitMatch } from "../utils/unitTypes";

export type SelectedTextConversionDependencies = {
  getRates: (baseCurrency: string) => Promise<ExchangeRates>;
};

export type ManualConversionResult = {
  source: string;
  converted: string;
};

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatUnit(
  amount: number,
  unit: UnitCode,
  useAutoFormatting: boolean
): string {
  const formattedAmount = new Intl.NumberFormat(
    undefined,
    useAutoFormatting
      ? { maximumSignificantDigits: 2 }
      : { maximumFractionDigits: 2 }
  ).format(amount);
  return `${formattedAmount} ${formatUnitLabel(unit)}`;
}

function getTargetUnit(match: UnitMatch, settings: UserSettings): UnitCode | null {
  const exactTarget =
    match.category === "length"
      ? settings.targetLengthUnit
      : match.category === "weight"
        ? settings.targetWeightUnit
        : settings.targetTemperatureUnit;

  return resolveTargetUnit(match.unit, settings.unitSystem, exactTarget);
}

async function convertFirstCurrency(
  text: string,
  settings: UserSettings,
  dependencies: SelectedTextConversionDependencies
): Promise<ManualConversionResult | null> {
  const match = parseCurrencies(text)[0];

  if (!match || match.currency === settings.targetCurrency) {
    return null;
  }

  const rates = await dependencies.getRates(settings.targetCurrency);
  const converted = convertCurrency(
    match.amount,
    match.currency,
    settings.targetCurrency,
    rates
  );

  return converted === null || !Number.isFinite(converted)
    ? null
    : {
        source: formatSourceCurrency(match.amount, match.currency),
        converted: formatCurrency(converted, settings.targetCurrency),
      };
}

function convertFirstUnit(
  text: string,
  settings: UserSettings
): ManualConversionResult | null {
  const match = parseUnits(text)[0];

  if (!match) {
    return null;
  }

  const targetUnit = getTargetUnit(match, settings);

  if (!targetUnit || targetUnit === match.unit) {
    return null;
  }

  const converted = convertUnit(match.amount, match.unit, targetUnit);

  if (converted === null || !Number.isFinite(converted)) {
    return null;
  }

  const exactTarget =
    match.category === "length"
      ? settings.targetLengthUnit
      : match.category === "weight"
        ? settings.targetWeightUnit
        : settings.targetTemperatureUnit;

  return {
    source: formatSourceUnit(match.amount, match.unit),
    converted: formatUnit(
      converted,
      targetUnit,
      exactTarget === "auto" && settings.unitSystem === "auto"
    ),
  };
}

export async function getManualConversion(
  text: string,
  settings: UserSettings,
  dependencies: SelectedTextConversionDependencies
): Promise<ManualConversionResult | null> {
  if (!settings.enabled || !text.trim()) {
    return null;
  }

  if (settings.converterMode !== "units") {
    let currencyResult: ManualConversionResult | null = null;

    try {
      currencyResult = await convertFirstCurrency(text, settings, dependencies);
    } catch {
      // A provider failure should not prevent an available unit conversion.
    }

    if (currencyResult) {
      return currencyResult;
    }
  }

  return settings.converterMode === "currencies"
    ? null
    : convertFirstUnit(text, settings);
}

export async function convertSelectedText(
  text: string,
  settings: UserSettings,
  dependencies: SelectedTextConversionDependencies
): Promise<string | null> {
  return (await getManualConversion(text, settings, dependencies))?.converted ?? null;
}
