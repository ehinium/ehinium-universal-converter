import { fiatCurrencies } from "../data/currencies";
import { normalizeNumberToken } from "./numberNormalizer";

export type CurrencyMatch = {
  raw: string;
  amount: number;
  currency: string;
};

type IndexedCurrencyMatch = CurrencyMatch & {
  index: number;
  end: number;
  specificity: number;
};

export type CurrencyIdentifierSupport = {
  identifier: string;
  currencies: string[];
  prefixCurrency?: string;
  suffixCurrency?: string;
  ambiguous: boolean;
};

const digitPattern = "[0-9٠-٩۰-۹]";
const groupingSeparatorPattern = "[ ,.\\u00a0\\u202f\\u2009'’٬]";
const decimalSeparatorPattern = "[.,٫]";
const leadingDecimalAmountPattern = `${decimalSeparatorPattern}${digitPattern}+`;
const indianGroupedAmountPattern =
  `${digitPattern}{1,2}(?:,${digitPattern}{2})+,${digitPattern}{3}` +
  `(?:\\.${digitPattern}+)?`;
const amountPattern =
  `[+-]?(?:${indianGroupedAmountPattern}|${leadingDecimalAmountPattern}|` +
  `${digitPattern}{1,3}(?:${groupingSeparatorPattern}${digitPattern}{3})+` +
  `(?:${decimalSeparatorPattern}${digitPattern}{1,2})?|${digitPattern}+` +
  `(?:${decimalSeparatorPattern}${digitPattern}+)?)`;
const optionalSpacePattern = "[\\s\\u00a0\\u202f\\u2009]*";
const numericStartBoundaryPattern =
  `(?<![\\p{L}\\p{N}_-])(?<!${decimalSeparatorPattern})` +
  `(?<!${digitPattern}${groupingSeparatorPattern})`;

const currencyByCode = new Map(
  fiatCurrencies.map((currency) => [currency.code, currency])
);

const identifierCurrencies = new Map<string, Set<string>>();

for (const currency of fiatCurrencies) {
  for (const identifier of [currency.code, ...currency.symbols]) {
    const codes = identifierCurrencies.get(identifier) ?? new Set<string>();

    codes.add(currency.code);
    identifierCurrencies.set(identifier, codes);
  }
}

// Bare symbols are inherently ambiguous. These conventional defaults preserve
// useful standalone matches; qualified symbols and ISO codes remain preferable.
const ambiguousSymbolDefaults = new Map<string, string>([
  ["$", "USD"],
  ["£", "GBP"],
  ["¥", "JPY"],
]);
const unsupportedAmbiguousSymbols = new Set(["R", "K", "F", "L", "P", "Q", "kr"]);
const unsafeSuffixSymbols = new Set([
  "$",
  "€",
  "£",
  "¥",
  "R",
  "K",
  "F",
  "L",
  "P",
  "Q",
  "kr",
  "%",
  "+",
]);

const symbolToCurrency = new Map<string, string>();
const suffixSymbolToCurrency = new Map<string, string>();

for (const [symbol, codes] of identifierCurrencies) {
  if (currencyByCode.has(symbol)) {
    continue;
  }

  if (
    unsupportedAmbiguousSymbols.has(symbol) ||
    /^[A-Za-z]$/u.test(symbol)
  ) {
    continue;
  }

  if (codes.size === 1) {
    const currency = codes.values().next().value;

    if (currency) {
      symbolToCurrency.set(symbol, currency);
    }

    continue;
  }

  const defaultCurrency = ambiguousSymbolDefaults.get(symbol);

  if (defaultCurrency && codes.has(defaultCurrency)) {
    symbolToCurrency.set(symbol, defaultCurrency);
  }
}

for (const [symbol, codes] of identifierCurrencies) {
  if (
    currencyByCode.has(symbol) ||
    unsafeSuffixSymbols.has(symbol) ||
    /^[A-Za-z]$/u.test(symbol) ||
    codes.size !== 1
  ) {
    continue;
  }

  const currency = codes.values().next().value;

  if (currency) {
    suffixSymbolToCurrency.set(symbol, currency);
  }
}

const codePattern = createAlternation([...currencyByCode.keys()]);
const symbolPattern = createAlternation([...symbolToCurrency.keys()]);
const suffixSymbolPattern = createAlternation([...suffixSymbolToCurrency.keys()]);

const codePrefixRegex = createPrefixRegex(codePattern, "giu");
const codeSuffixRegex = createSuffixRegex(codePattern, "giu");
const symbolPrefixRegex = createPrefixRegex(symbolPattern, "gu");
const symbolSuffixRegex = createSuffixRegex(suffixSymbolPattern, "gu");

/**
 * Describes the parser's production identifier policy without duplicating it in
 * development tools. ISO codes are supported in both positions. Shared and
 * unsafe symbols remain visible to diagnostics even when the parser declines
 * to resolve them.
 */
export function getCurrencyIdentifierSupport(
  identifier: string
): CurrencyIdentifierSupport {
  const normalizedCode = identifier.toUpperCase();

  if (currencyByCode.has(normalizedCode)) {
    return {
      identifier,
      currencies: [normalizedCode],
      prefixCurrency: normalizedCode,
      suffixCurrency: normalizedCode,
      ambiguous: false,
    };
  }

  const currencies = [...(identifierCurrencies.get(identifier) ?? [])].sort();

  return {
    identifier,
    currencies,
    prefixCurrency: symbolToCurrency.get(identifier),
    suffixCurrency: suffixSymbolToCurrency.get(identifier),
    ambiguous: currencies.length > 1 || unsupportedAmbiguousSymbols.has(identifier),
  };
}

function createAlternation(values: string[]): string {
  return values
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join("|");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createPrefixRegex(identifierPattern: string, flags: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_-])` +
      `(${identifierPattern})${optionalSpacePattern}(${amountPattern})` +
      `(?![\\p{L}\\p{N}_-]|${decimalSeparatorPattern}${digitPattern})`,
    flags
  );
}

function createSuffixRegex(identifierPattern: string, flags: string): RegExp {
  return new RegExp(
    numericStartBoundaryPattern +
      `(${amountPattern})${optionalSpacePattern}(${identifierPattern})` +
      `(?![\\p{L}\\p{N}_-])`,
    flags
  );
}

function collectMatches(
  text: string,
  regex: RegExp,
  identifierIndex: number,
  amountIndex: number,
  resolveCurrency: (identifier: string) => string | undefined,
  requireFullTextForNonCanonicalIdentifier = false
): IndexedCurrencyMatch[] {
  const matches: IndexedCurrencyMatch[] = [];

  for (const match of text.matchAll(regex)) {
    const identifier = match[identifierIndex];
    const amountText = match[amountIndex];
    const currency = resolveCurrency(identifier);
    const definition = currency ? currencyByCode.get(currency) : undefined;
    const isCanonicalIdentifier = identifier === currency;
    const isFullTextMatch = match[0].trim() === text.trim();

    if (
      !definition ||
      (requireFullTextForNonCanonicalIdentifier &&
        !isCanonicalIdentifier &&
        !isFullTextMatch)
    ) {
      continue;
    }

    const normalizedAmount = normalizeNumberToken(amountText);
    const parsedAmount = normalizedAmount?.value ?? null;

    if (parsedAmount === null) {
      continue;
    }

    const matchIndex = match.index;
    const matchEnd = matchIndex + match[0].length;
    const isAccountingNegative =
      text[matchIndex - 1] === "(" && text[matchEnd] === ")";
    const raw = isAccountingNegative ? `(${match[0]})` : match[0];
    const index = isAccountingNegative ? matchIndex - 1 : matchIndex;
    const amount = isAccountingNegative ? -Math.abs(parsedAmount) : parsedAmount;

    matches.push({
      raw,
      amount,
      currency: definition.code,
      index,
      end: index + raw.length,
      specificity: identifier.length,
    });
  }

  return matches;
}

export function parseCurrencies(text: string): CurrencyMatch[] {
  const resolveCode = (code: string): string | undefined => {
    const normalizedCode = code.toUpperCase();
    return currencyByCode.has(normalizedCode) ? normalizedCode : undefined;
  };
  const resolveSymbol = (symbol: string): string | undefined =>
    symbolToCurrency.get(symbol);
  const resolveSuffixSymbol = (symbol: string): string | undefined =>
    suffixSymbolToCurrency.get(symbol);
  const codeMatches = [
    ...collectMatches(text, codePrefixRegex, 1, 2, resolveCode, true),
    ...collectMatches(text, codeSuffixRegex, 2, 1, resolveCode, true),
  ];
  const symbolMatches = [
    ...collectMatches(text, symbolPrefixRegex, 1, 2, resolveSymbol),
    ...collectMatches(text, symbolSuffixRegex, 2, 1, resolveSuffixSymbol),
  ];
  const uniqueMatches = new Map<string, IndexedCurrencyMatch>();

  for (const match of [...codeMatches, ...symbolMatches]) {
    const key = `${match.index}\u0000${match.end}\u0000${match.raw}\u0000${match.amount}\u0000${match.currency}`;

    if (!uniqueMatches.has(key)) {
      uniqueMatches.set(key, match);
    }
  }

  const resolvedMatches: IndexedCurrencyMatch[] = [];

  for (const candidate of [...uniqueMatches.values()].sort(
    (left, right) =>
      left.index - right.index ||
      right.raw.length - left.raw.length ||
      right.specificity - left.specificity
  )) {
    const overlappingIndex = resolvedMatches.findIndex(
      (existing) =>
        existing.currency === candidate.currency &&
        Math.abs(existing.amount) === Math.abs(candidate.amount) &&
        candidate.index < existing.end &&
        existing.index < candidate.end
    );

    if (overlappingIndex === -1) {
      resolvedMatches.push(candidate);
      continue;
    }

    const existing = resolvedMatches[overlappingIndex];
    if (
      candidate.raw.length > existing.raw.length ||
      (candidate.raw.length === existing.raw.length &&
        candidate.specificity > existing.specificity)
    ) {
      resolvedMatches[overlappingIndex] = candidate;
    }
  }

  return resolvedMatches
    .sort((left, right) => left.index - right.index)
    .map(({ raw, amount, currency }) => ({ raw, amount, currency }));
}
