import { fiatCurrencies } from "../data/currencies";
import { normalizeNumberToken } from "./numberNormalizer";

export const CURRENCY_SAFE_FRAGMENT_BOUNDARY = "\ue000";

export type CurrencyMatch = {
  raw: string;
  amount: number;
  currency: string;
  start: number;
  end: number;
  tokenType: "iso" | "symbol" | "localized-name";
  confidence: number;
};

type IndexedCurrencyMatch = CurrencyMatch & {
  specificity: number;
  directionPriority: number;
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
const iranianGroupingSeparatorPattern = "[ ,.\\u00a0\\u202f\\u2009'’٬٫]";
const iranianAmountPattern =
  `[+-]?(?:${indianGroupedAmountPattern}|${leadingDecimalAmountPattern}|` +
  `${digitPattern}{1,3}(?:${iranianGroupingSeparatorPattern}${digitPattern}{3})+` +
  `(?:${decimalSeparatorPattern}${digitPattern}{1,2})?|${digitPattern}+` +
  `(?:${decimalSeparatorPattern}${digitPattern}+)?)`;
const optionalSpacePattern = `[\\s\\u00a0\\u202f\\u2009${CURRENCY_SAFE_FRAGMENT_BOUNDARY}]*`;
const iranianGlueCharacterPattern =
  `[\\s\\u00a0\\u202f\\u2009\\u200c-\\u200f\\u202a-\\u202e\\u2066-\\u2069${CURRENCY_SAFE_FRAGMENT_BOUNDARY}]`;
const optionalIranianGluePattern = `${iranianGlueCharacterPattern}*`;
const requiredIranianGluePattern = `${iranianGlueCharacterPattern}+`;
const numericStartBoundaryPattern =
  `(?<![\\p{L}\\p{N}_-])(?<!${decimalSeparatorPattern})` +
  `(?<!${digitPattern}${groupingSeparatorPattern})`;

const currencyByCode = new Map(
  fiatCurrencies.map((currency) => [currency.code, currency])
);

const identifierCurrencies = new Map<string, Set<string>>();
const iranianCurrencyCodes = new Set(["IRT", "IRR"]);
const iranianIdentifierToCurrency = new Map<string, string>();
const iranianInflectedSuffixes = new Map<string, string>([
  ["تومانی", "IRT"],
  ["ریالی", "IRR"],
]);

function normalizeIranianIdentifierKey(identifier: string): string {
  return identifier.toLocaleLowerCase("en-US");
}

for (const currency of fiatCurrencies) {
  for (const identifier of [currency.code, ...currency.symbols]) {
    const codes = identifierCurrencies.get(identifier) ?? new Set<string>();

    codes.add(currency.code);
    identifierCurrencies.set(identifier, codes);

    if (iranianCurrencyCodes.has(currency.code)) {
      iranianIdentifierToCurrency.set(
        normalizeIranianIdentifierKey(identifier),
        currency.code
      );
    }
  }
}

for (const [identifier, currency] of iranianInflectedSuffixes) {
  iranianIdentifierToCurrency.set(identifier, currency);
}

// Bare symbols are inherently ambiguous. These conventional defaults preserve
// useful standalone matches; qualified symbols and ISO codes remain preferable.
const ambiguousSymbolDefaults = new Map<string, string>([
  ["$", "USD"],
  ["£", "GBP"],
  ["¥", "JPY"],
]);
const unsupportedAmbiguousSymbols = new Set(["R", "K", "F", "L", "P", "Q", "kr"]);
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
    /^[A-Za-z]$/u.test(symbol) ||
    unsupportedAmbiguousSymbols.has(symbol) ||
    codes.size !== 1
  ) {
    continue;
  }

  const currency = codes.values().next().value;

  if (currency && codes.has(currency)) {
    suffixSymbolToCurrency.set(symbol, currency);
  }
}

const codePattern = createAlternation(
  [...currencyByCode.keys()].filter((code) => !iranianCurrencyCodes.has(code))
);
const iranianCodePattern = createAlternation([...iranianCurrencyCodes]);
const iranianIdentifierKeys = new Set(iranianIdentifierToCurrency.keys());
const isIranianIdentifier = (identifier: string): boolean =>
  iranianIdentifierKeys.has(normalizeIranianIdentifierKey(identifier));
const symbolPattern = createAlternation(
  [...symbolToCurrency.keys()].filter((identifier) => !isIranianIdentifier(identifier))
);
const suffixSymbolPattern = createAlternation(
  [...suffixSymbolToCurrency.keys()].filter(
    (identifier) => !isIranianIdentifier(identifier)
  )
);
const iranianAliasPrefixPattern = createAlternation(
  [...identifierCurrencies.keys()].filter(
    (identifier) =>
      isIranianIdentifier(identifier) && !currencyByCode.has(identifier)
  )
);
const iranianAliasSuffixPattern = createAlternation(
  [...iranianIdentifierToCurrency.keys()].filter(
    (identifier) => !currencyByCode.has(identifier)
  )
);

const codePrefixRegex = createPrefixRegex(codePattern, "giu");
const codeSuffixRegex = createSuffixRegex(codePattern, "giu");
const iranianCodePrefixRegex = createIranianCodePrefixRegex(iranianCodePattern);
const iranianCodeSuffixRegex = createIranianCodeSuffixRegex(iranianCodePattern);
const symbolPrefixRegex = createPrefixRegex(symbolPattern, "gu");
const symbolSuffixRegex = createSuffixRegex(suffixSymbolPattern, "gu");
const iranianAliasPrefixRegex = createIranianAliasPrefixRegex(
  iranianAliasPrefixPattern
);
const iranianAliasSuffixRegex = createIranianAliasSuffixRegex(
  iranianAliasSuffixPattern
);

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

function createIranianAliasPrefixRegex(identifierPattern: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_-])` +
      `((?:${identifierPattern})(?:ء+)?)${requiredIranianGluePattern}(${iranianAmountPattern})` +
      `(?![\\p{L}\\p{N}_-]|${decimalSeparatorPattern}${digitPattern})`,
    "giu"
  );
}

function createIranianCodePrefixRegex(identifierPattern: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_-])` +
      `(${identifierPattern})${optionalIranianGluePattern}(${iranianAmountPattern})` +
      `(?![\\p{L}\\p{N}_-]|${decimalSeparatorPattern}${digitPattern})`,
    "giu"
  );
}

function createIranianCodeSuffixRegex(identifierPattern: string): RegExp {
  return new RegExp(
    numericStartBoundaryPattern +
      `(${iranianAmountPattern})${optionalIranianGluePattern}(${identifierPattern})` +
      `(?![\\p{L}_-])`,
    "giu"
  );
}

function createIranianAliasSuffixRegex(identifierPattern: string): RegExp {
  return new RegExp(
    numericStartBoundaryPattern +
      `(${iranianAmountPattern})${optionalIranianGluePattern}((?:${identifierPattern})(?:ء+)?)` +
      `(?![\\p{L}_-])` +
      `(?!${optionalIranianGluePattern}ء)`,
    "giu"
  );
}

function isUnsafeIranianPrefixContext(
  text: string,
  matchStart: number,
  matchEnd: number
): boolean {
  const before = text.slice(0, matchStart);
  const after = text.slice(matchEnd);

  return (
    new RegExp(
      `(?:${digitPattern}|[%٪]|[,.٬٫])${optionalIranianGluePattern}$`,
      "u"
    ).test(before) ||
    new RegExp(`^${optionalIranianGluePattern}[%٪]`, "u").test(after)
  );
}

function collectMatches(
  text: string,
  regex: RegExp,
  identifierIndex: number,
  amountIndex: number,
  resolveCurrency: (identifier: string) => string | undefined,
  tokenType: CurrencyMatch["tokenType"],
  requireFullTextForNonCanonicalIdentifier = false,
  direction: "prefix" | "suffix" = "prefix"
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
    if (
      direction === "prefix" &&
      iranianCurrencyCodes.has(definition.code) &&
      isUnsafeIranianPrefixContext(text, matchIndex, matchEnd)
    ) {
      continue;
    }
    const isAccountingNegative =
      text[matchIndex - 1] === "(" && text[matchEnd] === ")";
    const matchedRaw = match[0].replaceAll(CURRENCY_SAFE_FRAGMENT_BOUNDARY, "");
    const raw = isAccountingNegative ? `(${matchedRaw})` : matchedRaw;
    const start = isAccountingNegative ? matchIndex - 1 : matchIndex;
    const amount = isAccountingNegative ? -Math.abs(parsedAmount) : parsedAmount;
    const identifierSupport = getCurrencyIdentifierSupport(identifier);
    const confidence =
      tokenType === "iso"
        ? 1
        : identifierSupport.ambiguous
          ? 0.75
          : 0.9;

    matches.push({
      raw,
      amount,
      currency: definition.code,
      start,
      end: isAccountingNegative ? matchEnd + 1 : matchEnd,
      tokenType,
      confidence,
      specificity: identifier.length,
      directionPriority: direction === "suffix" ? 2 : 1,
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
  const resolveIranianAlias = (identifier: string): string | undefined => {
    const undecoratedIdentifier = identifier.replace(/ء+$/u, "");

    return iranianIdentifierToCurrency.get(
      normalizeIranianIdentifierKey(undecoratedIdentifier)
    );
  };
  const codeMatches = [
    ...collectMatches(text, codePrefixRegex, 1, 2, resolveCode, "iso", true, "prefix"),
    ...collectMatches(text, codeSuffixRegex, 2, 1, resolveCode, "iso", true, "suffix"),
    ...collectMatches(text, iranianCodePrefixRegex, 1, 2, resolveCode, "iso", true, "prefix"),
    ...collectMatches(text, iranianCodeSuffixRegex, 2, 1, resolveCode, "iso", true, "suffix"),
  ];
  const symbolMatches = [
    ...collectMatches(text, symbolPrefixRegex, 1, 2, resolveSymbol, "symbol", false, "prefix"),
    ...collectMatches(text, symbolSuffixRegex, 2, 1, resolveSuffixSymbol, "symbol", false, "suffix"),
    ...collectMatches(
      text,
      iranianAliasPrefixRegex,
      1,
      2,
      resolveIranianAlias,
      "symbol",
      false,
      "prefix"
    ),
    ...collectMatches(
      text,
      iranianAliasSuffixRegex,
      2,
      1,
      resolveIranianAlias,
      "symbol",
      false,
      "suffix"
    ),
  ];
  const uniqueMatches = new Map<string, IndexedCurrencyMatch>();

  for (const match of [...codeMatches, ...symbolMatches]) {
    const key = `${match.start}\u0000${match.end}\u0000${match.raw}\u0000${match.amount}\u0000${match.currency}`;

    if (!uniqueMatches.has(key)) {
      uniqueMatches.set(key, match);
    }
  }

  const resolvedMatches: IndexedCurrencyMatch[] = [];

  for (const candidate of [...uniqueMatches.values()].sort(
    (left, right) =>
      left.start - right.start ||
      right.directionPriority - left.directionPriority ||
      (right.end - right.start) - (left.end - left.start) ||
      right.specificity - left.specificity ||
      right.confidence - left.confidence
  )) {
    const overlappingIndex = resolvedMatches.findIndex(
      (existing) =>
        candidate.start < existing.end && existing.start < candidate.end
    );

    if (overlappingIndex === -1) {
      resolvedMatches.push(candidate);
      continue;
    }

    const existing = resolvedMatches[overlappingIndex];
    const candidateSpan = candidate.end - candidate.start;
    const existingSpan = existing.end - existing.start;
    if (
      candidate.directionPriority > existing.directionPriority ||
      (candidate.directionPriority === existing.directionPriority &&
        candidateSpan > existingSpan) ||
      (candidate.directionPriority === existing.directionPriority &&
        candidateSpan === existingSpan && candidate.specificity > existing.specificity) ||
      (candidate.directionPriority === existing.directionPriority &&
        candidateSpan === existingSpan &&
        candidate.specificity === existing.specificity &&
        candidate.confidence > existing.confidence)
    ) {
      resolvedMatches[overlappingIndex] = candidate;
    }
  }

  const finalMatches = resolvedMatches
    .sort((left, right) => left.start - right.start)
    .map((match) => ({
      raw: match.raw,
      amount: match.amount,
      currency: match.currency,
      start: match.start,
      end: match.end,
      tokenType: match.tokenType,
      confidence: match.confidence,
    }));
  const sequentialMatches = finalMatches.flatMap((match) => {
    if (
      !iranianCurrencyCodes.has(match.currency) ||
      !/^[\s(]*[+-]?[0-9٠-٩۰-۹]/u.test(match.raw) ||
      !new RegExp(`^${digitPattern}`, "u").test(text.slice(match.end))
    ) return [];
    return parseCurrencies(text.slice(match.end)).map((following) => ({
      ...following,
      start: following.start + match.end,
      end: following.end + match.end,
    }));
  });

  return [...finalMatches, ...sequentialMatches]
    .filter((match, index, all) =>
      all.findIndex((candidate) =>
        candidate.start === match.start && candidate.end === match.end &&
        candidate.currency === match.currency && candidate.amount === match.amount
      ) === index
    )
    .sort((left, right) => left.start - right.start);
}
