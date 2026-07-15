import type { ExchangeRateStatus } from "../services/rates";
import type { UserSettings } from "../types/settings";
import { parseCurrencies } from "../utils/currencyParser";
import { parseUnits } from "../utils/unitParser";

export type ManualFeedback = {
  message: string;
  tone: "neutral" | "error";
  invalid: boolean;
};

function looksLikeIncompleteManualInput(value: string): boolean {
  return (
    /^[+-]?[\d\s.,]+$/u.test(value) ||
    /^\p{L}{1,5}$/u.test(value) ||
    /^[+-]?[\d\s.,]+\s*°?\p{L}{1,2}$/u.test(value)
  );
}

export function getManualFeedback(
  value: string,
  settings: UserSettings,
  status: ExchangeRateStatus
): ManualFeedback {
  const input = value.trim();

  if (!input) {
    return {
      message: "Enter a value to see its conversion.",
      tone: "neutral",
      invalid: false,
    };
  }

  const currencyMatch = parseCurrencies(input)[0];
  const unitMatch = parseUnits(input)[0];

  if (currencyMatch) {
    if (settings.converterMode === "units") {
      return {
        message: "Currency conversion is off in the selected conversion mode.",
        tone: "neutral",
        invalid: false,
      };
    }

    if (currencyMatch.currency === settings.targetCurrency) {
      return {
        message: `This value is already in ${settings.targetCurrency}.`,
        tone: "neutral",
        invalid: false,
      };
    }

    if (status.lastErrorAt !== null) {
      return {
        message: "Currency conversion is temporarily unavailable because rates could not be loaded.",
        tone: "error",
        invalid: false,
      };
    }

    return {
      message: "No conversion is available for this currency with the current rates.",
      tone: "neutral",
      invalid: false,
    };
  }

  if (unitMatch) {
    return {
      message:
        settings.converterMode === "currencies"
          ? "Unit conversion is off in the selected conversion mode."
          : "No conversion is needed with the current unit settings.",
      tone: "neutral",
      invalid: false,
    };
  }

  if (looksLikeIncompleteManualInput(input)) {
    return {
      message: "Add a supported currency or measurement unit to complete the value.",
      tone: "neutral",
      invalid: false,
    };
  }

  return {
    message: "Unsupported value. Try a currency or measurement with its unit.",
    tone: "error",
    invalid: true,
  };
}
