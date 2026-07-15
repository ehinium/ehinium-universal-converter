export type NormalizedNumber = {
  raw: string;
  value: number;
  decimalSeparator: "." | "," | null;
  groupingSeparators: string[];
};

const groupingSeparatorRegex = /[\u0020\u00a0\u202f\u2009'’]/gu;

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function uniqueSeparators(value: string): string[] {
  return [...new Set(value.match(/[\u0020\u00a0\u202f\u2009'’,.]/gu) ?? [])];
}

function separatorIsDecimal(
  normalized: string,
  separator: "." | ","
): boolean {
  const parts = normalized.split(separator);
  const fractionalLength = parts.at(-1)?.length ?? 0;

  return parts.length <= 2 && fractionalLength > 0 && fractionalLength !== 3;
}

function hasMalformedRepeatedPunctuation(value: string): boolean {
  return /[,.]{2,}/u.test(value);
}

function hasMalformedApostropheGrouping(value: string): boolean {
  const groups = value.split(/['’]/u);

  return (
    groups.length > 1 &&
    !(
      /^[0-9]{1,3}$/u.test(groups[0]) &&
      groups.slice(1).every((group, index) => {
        const isLast = index === groups.length - 2;
        return isLast
          ? /^[0-9]{3}(?:[,.][0-9]+)?$/u.test(group)
          : /^[0-9]{3}$/u.test(group);
      })
    )
  );
}

function isWesternGrouped(value: string, separator: "," | "."): boolean {
  const escapedSeparator = separator === "." ? "\\." : separator;
  return new RegExp(
    `^[0-9]{1,3}(?:${escapedSeparator}[0-9]{3})+$`,
    "u"
  ).test(value);
}

function isIndianGrouped(value: string): boolean {
  return /^[0-9]{1,2}(?:,[0-9]{2})+,[0-9]{3}$/u.test(value);
}

function hasMalformedCommaOrDotGrouping(value: string): boolean {
  const unsigned = value.replace(/^[+-]/u, "");
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastDot > lastComma) {
      const integer = unsigned.slice(0, lastDot);
      return (
        integer.includes(",") &&
        !isWesternGrouped(integer, ",") &&
        !isIndianGrouped(integer)
      );
    }

    const integer = unsigned.slice(0, lastComma);
    return integer.includes(".") && !isWesternGrouped(integer, ".");
  }

  if ((unsigned.match(/,/gu) ?? []).length > 1) {
    return !isWesternGrouped(unsigned, ",") && !isIndianGrouped(unsigned);
  }

  if ((unsigned.match(/\./gu) ?? []).length > 1) {
    return !isWesternGrouped(unsigned, ".");
  }

  return false;
}

export function normalizeNumberToken(raw: string): NormalizedNumber | null {
  let normalized = normalizeDigits(raw)
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");

  const sign = normalized.startsWith("-") ? -1 : 1;
  normalized = normalized.replace(/^[+-]/u, "");

  if (!/[0-9]/u.test(normalized)) {
    return null;
  }

  if (
    hasMalformedRepeatedPunctuation(normalized) ||
    hasMalformedApostropheGrouping(normalized) ||
    hasMalformedCommaOrDotGrouping(normalized)
  ) {
    return null;
  }

  const groupingSeparators = uniqueSeparators(normalized);
  normalized = normalized.replace(groupingSeparatorRegex, "");

  if (normalized.startsWith(".") || normalized.startsWith(",")) {
    normalized = `0${normalized}`;
  }

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  const hasComma = lastComma !== -1;
  const hasDot = lastDot !== -1;
  let decimalSeparator: "." | "," | null = null;

  if (hasComma && hasDot) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized
      .replaceAll(thousandsSeparator, "")
      .replace(decimalSeparator, ".");
  } else if (hasComma || hasDot) {
    const separator = hasComma ? "," : ".";

    if (separatorIsDecimal(normalized, separator)) {
      decimalSeparator = separator;
      const parts = normalized.split(separator);
      normalized = `${parts[0]}.${parts.slice(1).join("")}`;
    } else {
      normalized = normalized.split(separator).join("");
    }
  }

  if (!/^[0-9]+(?:\.[0-9]+)?$/u.test(normalized)) {
    return null;
  }

  const value = sign * Number(normalized);

  return Number.isFinite(value)
    ? {
        raw,
        value,
        decimalSeparator,
        groupingSeparators,
      }
    : null;
}
