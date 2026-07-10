import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { convertCurrency } from "../utils/currencyConverter";
import { parseCurrencies } from "../utils/currencyParser";
import {
  formatConvertedCurrency,
  formatConvertedUnit,
  formatSourceCurrency,
  formatSourceUnit,
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
        converted: formatConvertedCurrency(converted, settings.targetCurrency),
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

  return {
    source: formatSourceUnit(match.amount, match.unit),
    converted: formatConvertedUnit(converted, targetUnit),
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
