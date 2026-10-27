import { fiatCurrencies } from "../data/currencies";
import { countriesForCurrency, type CurrencyContext } from "./currencyContext";
import { lazy } from "./lazy";
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
// "−" (U+2212) is the typographic minus: IKEA's "−79.01€" is a negative difference.
const amountPattern =
  `[+\\-−]?(?:${indianGroupedAmountPattern}|${leadingDecimalAmountPattern}|` +
  `${digitPattern}{1,3}(?:${groupingSeparatorPattern}${digitPattern}{3})+` +
  `(?:${decimalSeparatorPattern}${digitPattern}{1,3})?|${digitPattern}+` +
  `(?:${decimalSeparatorPattern}${digitPattern}+)?)`;
const iranianGroupingSeparatorPattern = "[ ,.\\u00a0\\u202f\\u2009'’٬٫]";
const iranianAmountPattern =
  `[+\\-−]?(?:${indianGroupedAmountPattern}|${leadingDecimalAmountPattern}|` +
  `${digitPattern}{1,3}(?:${iranianGroupingSeparatorPattern}${digitPattern}{3})+` +
  `(?:${decimalSeparatorPattern}${digitPattern}{1,2})?|${digitPattern}+` +
  `(?:${decimalSeparatorPattern}${digitPattern}+)?)`;
// Bidi marks appear between Arabic currency names and digits ("د.إ.\u200f228.99").
const bidiMarkPattern = "\\u200e\\u200f\\u061c\\u202a-\\u202e\\u2066-\\u2069";
const optionalSpacePattern = `[\\s\\u00a0\\u202f\\u2009${bidiMarkPattern}${CURRENCY_SAFE_FRAGMENT_BOUNDARY}]*`;
const iranianGlueCharacterPattern =
  `[\\s\\u00a0\\u202f\\u2009\\u200c-\\u200f\\u202a-\\u202e\\u2066-\\u2069${CURRENCY_SAFE_FRAGMENT_BOUNDARY}]`;
const optionalIranianGluePattern = `${iranianGlueCharacterPattern}*`;
const requiredIranianGluePattern = `${iranianGlueCharacterPattern}+`;
// Letters of scripts that separate words with spaces. A price glued to one of
// them is part of a word or a model name; CJK and Thai text has no spaces.
const spacedScriptLetterPattern =
  "\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Armenian}\\p{Script=Georgian}";
// A hyphen right before a price separates a range ("10-$20", "18.00-AED148.00")
// only after a digit or a currency sign; elsewhere it joins a word or a model.
// A hyphen glued to a word ("USB-5€") is not a sign; at the start, after a
// space or after "(" it is one ("-$5", "Coupon -$5.00").
const hyphenStartBoundaryPattern = "(?<![\\p{L}\\p{M}_]-)";
// ...and right after a price it continues a range only before a number, a
// currency sign or an ISO code ("$10-$20", "AED118.00-AED148.00").
const hyphenEndBoundaryPattern = "-(?![\\p{N}\\p{Sc}\\p{Lu}])";
// CJK numbers carry magnitudes: in "1万5000円" (15,000 yen) the "5000" is no amount of its own.
const cjkMagnitudePattern = "十百千万萬億亿兆십백천만억조";
const numericStartBoundaryPattern =
  `(?<![${spacedScriptLetterPattern}\\p{N}_${cjkMagnitudePattern}])${hyphenStartBoundaryPattern}(?<!${decimalSeparatorPattern})` +
  `(?<!${digitPattern}${groupingSeparatorPattern})(?<![${cjkMagnitudePattern}]\\s)`;
const iranianNumericStartBoundaryPattern =
  `(?<![\\p{L}\\p{N}_-])(?<!${decimalSeparatorPattern})` +
  `(?<!${digitPattern}${groupingSeparatorPattern})`;
const rangeSeparatorPattern =
  "(?:[-‐‑‒–—−~～〜]|\\s(?:to|a|à|al|bis|til|till|tot|ila|até|do)\\s)";

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

// Bare symbols are inherently ambiguous. Without page context these
// conventional defaults preserve useful standalone matches; the page context
// (see currencyContext.ts) picks the local currency when it shares the symbol.
const ambiguousSymbolDefaults = new Map<string, string>([
  ["$", "USD"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["￥", "JPY"],
  ["₩", "KRW"],
  ["元", "CNY"],
  ["ريال", "SAR"],
  ["درهم", "AED"],
  ["جنيه", "EGP"],
]);
// Shared identifiers too generic to default to any one currency.
const unsupportedAmbiguousSymbols = new Set(["R", "K", "F", "L", "P", "Q", "kr"]);
// Short Latin abbreviations that are distinctive enough to stand alone. Other
// two- or three-letter symbols ("MK", "FC", "KM", "Ft", "MT") collide with model
// names and units, so they need a price-shaped amount or the page's currency.
// All-caps "DHS" is also a department ("The DHS 2025 Budget"); "Dhs" is the dirham.
const strongLetterSymbols = new Set([
  "TL", "zł", "Kč", "Rp", "RM", "KSh", "USh", "TSh", "KD", "JD", "Lek", "Dhs", "Dhs.",
]);
// Han, Hangul and kana currency names are written without spaces around them.
const unspacedIdentifiers = new Set(["円", "元", "원", "圓"]);
// Words that 円, 元 and 원 begin: "2元素" is two elements, "3원색" three primary colours.
const unspacedIdentifierWordPattern =
  "(?<=元)(?:素|宵|旦|年|件|首|帅|帥|气|氣|老|月|代)|(?<=円)(?:形|周|安|高|盤|柱|錐|滑|満)|(?<=원)(?:색|피스|룸|형|소|본|래)";
const symbolToCurrency = new Map<string, string>();
const suffixSymbolToCurrency = new Map<string, string>();

/** Lone Latin letters (R, K, L, T, m) only name a currency on that currency's own pages. */
function isSingleLetter(identifier: string): boolean {
  return /^\p{Script=Latin}$/u.test(identifier);
}

for (const [symbol, codes] of identifierCurrencies) {
  if (currencyByCode.has(symbol)) {
    continue;
  }

  if (
    unsupportedAmbiguousSymbols.has(symbol) ||
    isSingleLetter(symbol)
  ) {
    continue;
  }

  if (codes.size === 1) {
    const currency = codes.values().next().value;

    if (currency) {
      symbolToCurrency.set(symbol, currency);
      suffixSymbolToCurrency.set(symbol, currency);
    }

    continue;
  }

  const defaultCurrency = ambiguousSymbolDefaults.get(symbol);

  if (defaultCurrency && codes.has(defaultCurrency)) {
    symbolToCurrency.set(symbol, defaultCurrency);
  }
}

let activeCurrencyContext: CurrencyContext | null = null;

/** Sets the page currency context used when `parseCurrencies` gets none. */
export function setActiveCurrencyContext(context: CurrencyContext | null): void {
  activeCurrencyContext = context;
}

export function getActiveCurrencyContext(): CurrencyContext | null {
  return activeCurrencyContext;
}

type Resolution = { currency: string; fromContext: boolean };

/**
 * Resolves a currency identifier. Unambiguous symbols always resolve the same
 * way; shared ones prefer the page's currency or country, then the default.
 */
function resolveIdentifier(
  identifier: string,
  context: CurrencyContext | null
): Resolution | undefined {
  const codes = identifierCurrencies.get(identifier);
  if (!codes) return undefined;
  const contextAgrees = (currency: string) =>
    !!context && (context.currency === currency ||
      (!!context.country && countriesForCurrency(currency).has(context.country)));
  const contextOnly = isSingleLetter(identifier) || unsupportedAmbiguousSymbols.has(identifier);

  if (codes.size === 1 && !contextOnly) {
    const currency = codes.values().next().value as string;
    return { currency, fromContext: contextAgrees(currency) };
  }
  if (context) {
    if (context.currency && codes.has(context.currency)) {
      return { currency: context.currency, fromContext: true };
    }
    // Iranian pages occasionally write rial with the Arabic yeh (ريال).
    if (identifier === "ريال" && (context.country === "IR" || context.currency === "IRT")) {
      return { currency: "IRR", fromContext: true };
    }
    for (const code of codes) {
      if (contextAgrees(code)) return { currency: code, fromContext: true };
    }
  }
  if (contextOnly) return undefined;
  const fallback = ambiguousSymbolDefaults.get(identifier);
  return fallback && codes.has(fallback) ? { currency: fallback, fromContext: false } : undefined;
}

/**
 * Describes the parser's production identifier policy without duplicating it in
 * development tools. ISO codes are supported in both positions. Shared and
 * unsafe symbols remain visible to diagnostics even when the parser declines
 * to resolve them without page context.
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

/** Resolves a bare currency symbol (an Amazon `.a-price-symbol`, an icon label). */
export function resolveCurrencySymbol(
  symbol: string,
  context: CurrencyContext | null = activeCurrencyContext
): string | undefined {
  const trimmed = symbol.trim();
  const code = trimmed.toUpperCase();
  if (currencyByCode.has(code) && /^[A-Za-z]{3}$/u.test(trimmed)) return code;
  return resolveIdentifier(trimmed, context)?.currency;
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

const nonIsoIdentifiers = [...identifierCurrencies.keys()].filter(
  (identifier) =>
    !currencyByCode.has(identifier) &&
    ![...identifierCurrencies.get(identifier)!].every((code) => iranianCurrencyCodes.has(code))
);
const codePattern = createAlternation(
  [...currencyByCode.keys()].filter((code) => !iranianCurrencyCodes.has(code))
);
const iranianCodePattern = createAlternation([...iranianCurrencyCodes]);
const iranianIdentifierKeys = new Set(iranianIdentifierToCurrency.keys());
const isIranianIdentifier = (identifier: string): boolean =>
  iranianIdentifierKeys.has(normalizeIranianIdentifierKey(identifier));
const symbolPattern = createAlternation(nonIsoIdentifiers);
const spacedSuffixSymbolPattern = createAlternation(
  nonIsoIdentifiers.filter((identifier) => !unspacedIdentifiers.has(identifier))
);
const unspacedSuffixSymbolPattern = createAlternation(
  nonIsoIdentifiers.filter((identifier) => unspacedIdentifiers.has(identifier))
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

const codePrefixRegex = createPrefixRegex(codePattern, "giu", false);
const codeSuffixRegex = createSuffixRegex(codePattern, "giu", true);
const symbolPrefixRegex = createPrefixRegex(symbolPattern, "gu", true);
const symbolSuffixRegex = createSuffixRegex(spacedSuffixSymbolPattern, "gu", true);
// The passes below run only on texts that pass their guard, so most pages never build them.
const iranianCodePrefixRegex = lazy(() => createIranianCodePrefixRegex(iranianCodePattern));
const iranianCodeSuffixRegex = lazy(() => createIranianCodeSuffixRegex(iranianCodePattern));
const unspacedSymbolSuffixRegex = lazy(() => createSuffixRegex(unspacedSuffixSymbolPattern, "gu", false));
const iranianAliasPrefixRegex = lazy(() => createIranianAliasPrefixRegex(iranianAliasPrefixPattern));
const iranianAliasSuffixRegex = lazy(() => createIranianAliasSuffixRegex(iranianAliasSuffixPattern));
// Cheap tests that skip whole passes a text cannot match: each full pattern
// needs one of these substrings, so skipping changes no result.
const iranianTextGuard = new RegExp(
  [iranianAliasPrefixPattern, iranianAliasSuffixPattern, iranianCodePattern].filter(Boolean).join("|"),
  "iu"
);
const isoCodeGuard = /[A-Za-z]{3}/u;
const unspacedSymbolGuard = new RegExp(unspacedSuffixSymbolPattern, "u");
const dashSuffixGuard = /[.,][-–—]/u;
// "۹۹۰ هزار تومان", "۲ میلیون و ۵۰۰ هزار تومان"
const persianMagnitudes: Readonly<Record<string, number>> = {
  "هزار": 1e3, "میلیون": 1e6, "ملیون": 1e6, "میلیارد": 1e9,
};
const persianMagnitudePattern = createAlternation(Object.keys(persianMagnitudes));
const persianMagnitudeRegex = lazy(() => new RegExp(
  iranianNumericStartBoundaryPattern +
    `(${iranianAmountPattern})${optionalIranianGluePattern}(${persianMagnitudePattern})` +
    `(?:${optionalIranianGluePattern}و${optionalIranianGluePattern}(${iranianAmountPattern})${optionalIranianGluePattern}(${persianMagnitudePattern}))?` +
    `${optionalIranianGluePattern}(تومان|تومن|ریال)(?![\\p{L}_-])`,
  "gu"
));
// Nordic and Czech prices written without a currency: "2 990,–", "10 990,-".
const dashSuffixPriceRegex = lazy(() => new RegExp(
  numericStartBoundaryPattern +
    `(${digitPattern}{1,3}(?:${groupingSeparatorPattern}${digitPattern}{3})*|${digitPattern}+)[.,][-–—](?![\\p{L}\\p{N}])`,
  "gu"
));
// A currency written after the dash names the price: "29,- €", "1.290,- EUR".
const dashTrailingCodeRegex = lazy(() => new RegExp(`${optionalSpacePattern}(${codePattern})(?![\\p{L}\\p{N}])`, "iuy"));
const dashTrailingSymbolRegex = lazy(() => new RegExp(`${optionalSpacePattern}(${spacedSuffixSymbolPattern})(?![\\p{L}\\p{N}])`, "uy"));

function createPrefixRegex(identifierPattern: string, flags: string, symbolic: boolean): RegExp {
  const letters = symbolic ? spacedScriptLetterPattern : "\\p{L}";
  return new RegExp(
    `(?<![${letters}\\p{N}_])${hyphenStartBoundaryPattern}` +
      `(${identifierPattern})${optionalSpacePattern}(${amountPattern})` +
      `(?![${letters}\\p{N}_]|${hyphenEndBoundaryPattern}|${decimalSeparatorPattern}${digitPattern})`,
    flags
  );
}

function createSuffixRegex(identifierPattern: string, flags: string, wordBoundaryAfter: boolean): RegExp {
  return new RegExp(
    numericStartBoundaryPattern +
      `(${amountPattern})${optionalSpacePattern}(${identifierPattern})` +
      (wordBoundaryAfter
        ? `(?![\\p{L}\\p{N}_]|${hyphenEndBoundaryPattern})`
        : `(?!\\p{N}|${unspacedIdentifierWordPattern})`),
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
    iranianNumericStartBoundaryPattern +
      `(${iranianAmountPattern})${optionalIranianGluePattern}(${identifierPattern})` +
      `(?![\\p{L}_-])`,
    "giu"
  );
}

function createIranianAliasSuffixRegex(identifierPattern: string): RegExp {
  return new RegExp(
    iranianNumericStartBoundaryPattern +
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

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

/** Two-letter symbols such as MK or FC also appear in model names ("MK02", "EA FC 26"). */
function isWeakIdentifier(identifier: string): boolean {
  const letters = identifier.replace(/\.$/u, "");
  return /^\p{Script=Latin}{2,3}$/u.test(letters) &&
    !currencyByCode.has(identifier.toUpperCase()) &&
    !strongLetterSymbols.has(identifier) &&
    // Iranian names (TMN, Rial) have their own percentage and prefix safeguards.
    !isIranianIdentifier(identifier);
}

/** Grouped thousands or a decimal part: what prices look like, unlike model numbers. */
function looksLikePrice(amountText: string): boolean {
  const normalized = normalizeDigits(amountText.trim());
  return /[0-9][ ,.\u00a0\u202f\u2009'’٬][0-9]{3}/u.test(normalized) ||
    /[.,٫][0-9]{2,3}$/u.test(normalized);
}

/**
 * A lone letter (R, K, L, D) also names models and units: "Canon EOS R5",
 * "Canon R100", "BMW R1200", "R2-D2", "4K", "3D", "1.5 L". Even on a page in
 * its currency it is a price only when spaced from the amount ("R 6,499") or
 * before a price-shaped amount ("R1,299.00", "R299.99"), and after an amount
 * only spaced with grouped thousands ("25,000 K").
 */
function hasSingleLetterPriceShape(raw: string, amountText: string, direction: "prefix" | "suffix"): boolean {
  if (direction === "suffix") {
    return /[0-9٠-٩۰-۹][\s\u00a0\u202f]+\p{L}$/u.test(raw.trim()) &&
      /[0-9][ ,.\u00a0\u202f\u2009'’٬][0-9]{3}/u.test(normalizeDigits(amountText));
  }
  const spaced = /^\p{L}[\s\u00a0\u202f]+/u.test(raw.trim());
  return spaced || looksLikePrice(amountText);
}

function hasLeadingZero(amountText: string): boolean {
  return /^[+\-−]?0[0-9]/u.test(normalizeDigits(amountText.trim()));
}

/** Kuwaiti dinar and its peers have three decimals: "239.900 KD" is 239.9, not 239,900. */
function threeDecimalAmount(amountText: string, currency: string): number | null {
  const definition = currencyByCode.get(currency);
  // Iraqi prices are quoted in whole dinars despite the three ISO decimals.
  if (!definition || definition.decimalDigits !== 3 || currency === "IQD") return null;
  const normalized = normalizeDigits(amountText.trim());
  const separator = currency === "TND" ? "[.,]" : "\\.";
  const match = new RegExp(`^([+\\-−]?)([0-9]{1,3})${separator}([0-9]{3})$`, "u").exec(normalized);
  if (!match) return null;
  const value = Number(`${match[2]}.${match[3]}`);
  return match[1] === "-" || match[1] === "−" ? -value : value;
}

/**
 * Parentheses mark a negative amount in statements ("(1,234.56 USD)"), not in
 * prose ("two dollars ($2.00)").
 */
function isAccountingNegative(text: string, start: number, end: number): boolean {
  if (text[start - 1] !== "(" || text[end] !== ")") return false;
  return /(?:^|[:=|])\s*$/u.test(text.slice(0, start - 1));
}

function collectMatches(
  text: string,
  regex: RegExp,
  identifierIndex: number,
  amountIndex: number,
  resolveCurrency: (identifier: string) => Resolution | undefined,
  tokenType: CurrencyMatch["tokenType"],
  requireFullTextForNonCanonicalIdentifier = false,
  direction: "prefix" | "suffix" = "prefix"
): IndexedCurrencyMatch[] {
  const matches: IndexedCurrencyMatch[] = [];

  for (const match of text.matchAll(regex)) {
    const identifier = match[identifierIndex];
    const amountText = match[amountIndex];
    const resolution = resolveCurrency(identifier);
    const definition = resolution ? currencyByCode.get(resolution.currency) : undefined;
    const isCanonicalIdentifier = identifier === resolution?.currency;
    const isFullTextMatch = match[0].trim() === text.trim();

    if (
      !definition ||
      !resolution ||
      (requireFullTextForNonCanonicalIdentifier &&
        !isCanonicalIdentifier &&
        !isFullTextMatch)
    ) {
      continue;
    }

    if (hasLeadingZero(amountText)) continue;
    // Letters glued to a signed number are a form or model code: "DHS-160", "EUR-2024".
    if (direction === "prefix" && /^\p{L}[\p{L}.]*[-−]/u.test(match[0])) continue;
    if (tokenType === "symbol" && isWeakIdentifier(identifier) && !resolution.fromContext && !looksLikePrice(amountText)) {
      continue;
    }
    // "đ" is the dong's own sign; the plain letters are the ones that name models.
    if (tokenType === "symbol" && /^[A-Za-z]$/u.test(identifier) && !hasSingleLetterPriceShape(match[0], amountText, direction)) {
      continue;
    }

    const normalizedAmount = normalizeNumberToken(amountText);
    const parsedAmount =
      threeDecimalAmount(amountText, definition.code) ?? normalizedAmount?.value ?? null;

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
    const accountingNegative = isAccountingNegative(text, matchIndex, matchEnd);
    // A minus right before the currency sign ("-$5", "Coupon −€10"); a hyphen
    // after a digit is a range ("£25-£855") and keeps both amounts positive.
    const signedSymbol = !accountingNegative && parsedAmount > 0 && /[-−]/u.test(text[matchIndex - 1] ?? "") &&
      (matchIndex === 1 || /[\s([:=|]/u.test(text[matchIndex - 2]));
    const matchedRaw = match[0].replaceAll(CURRENCY_SAFE_FRAGMENT_BOUNDARY, "");
    const raw = accountingNegative ? `(${matchedRaw})` : signedSymbol ? `${text[matchIndex - 1]}${matchedRaw}` : matchedRaw;
    const start = accountingNegative || signedSymbol ? matchIndex - 1 : matchIndex;
    const amount = accountingNegative || signedSymbol ? -Math.abs(parsedAmount) : parsedAmount;
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
      end: accountingNegative ? matchEnd + 1 : matchEnd,
      tokenType,
      confidence,
      specificity: identifier.length,
      directionPriority: direction === "suffix" ? 2 : 1,
    });
  }

  return matches;
}

function collectPersianMagnitudeMatches(text: string): IndexedCurrencyMatch[] {
  const matches: IndexedCurrencyMatch[] = [];
  for (const match of text.matchAll(persianMagnitudeRegex())) {
    const first = normalizeNumberToken(match[1])?.value;
    const second = match[3] ? normalizeNumberToken(match[3])?.value : 0;
    if (first === undefined || second === undefined) continue;
    const amount = first * persianMagnitudes[match[2]] +
      (match[3] ? second * persianMagnitudes[match[4]] : 0);
    const currency = match[5] === "ریال" ? "IRR" : "IRT";
    matches.push({
      raw: match[0],
      amount,
      currency,
      start: match.index,
      end: match.index + match[0].length,
      tokenType: "localized-name",
      confidence: 0.9,
      specificity: match[0].length,
      directionPriority: 2,
    });
  }
  return matches;
}

// Units of CJK numbers written with digits: "1万5000円" (15,000), "2억 5천만원" (250,000,000).
const CJK_UNITS: Readonly<Record<string, { value: number; big: boolean }>> = {
  "千": { value: 1e3, big: false }, "천": { value: 1e3, big: false },
  "万": { value: 1e4, big: true }, "萬": { value: 1e4, big: true }, "만": { value: 1e4, big: true },
  "億": { value: 1e8, big: true }, "亿": { value: 1e8, big: true }, "억": { value: 1e8, big: true },
  "兆": { value: 1e12, big: true }, "조": { value: 1e12, big: true },
};
const cjkUnitPattern = Object.keys(CJK_UNITS).join("");
const cjkMagnitudeGuard = new RegExp(`[${cjkUnitPattern}]`, "u");
const cjkMagnitudeRegex = lazy(() => new RegExp(
  `(?<![\\p{N}.,${cjkMagnitudePattern}])` +
    `(${digitPattern}(?:[0-9٠-٩۰-۹.,]|\\s?[${cjkUnitPattern}]\\s?)*?[${cjkUnitPattern}](?:\\s?${digitPattern}[0-9٠-٩۰-۹,]*)?)` +
    `\\s?(円|元|원|圓)(?!\\p{N}|${unspacedIdentifierWordPattern})`,
  "gu"
));

/**
 * The value of digits mixed with CJK units: "1億2000万" is 120,000,000, "5천만"
 * 50,000,000. Big units must descend, and what follows the last unit must stay
 * below it; anything else is no number.
 */
function cjkMagnitudeAmount(expression: string): number | null {
  const tokens = expression.replace(/\s/gu, "").match(new RegExp(`[${cjkUnitPattern}]|[^${cjkUnitPattern}]+`, "gu")) ?? [];
  let total = 0;
  let section = 0;
  let current: number | null = null;
  let lastBig = Infinity;
  let smallest = Infinity;
  for (const [index, token] of tokens.entries()) {
    const unit = CJK_UNITS[token];
    if (!unit) {
      // A decimal coefficient ("1.5万") is only written first.
      const value = normalizeNumberToken(token)?.value;
      if (value === undefined || current !== null || (index > 0 && !Number.isInteger(value))) return null;
      current = value;
      continue;
    }
    if (unit.big) {
      // "5천만": the thousands before 만 are its coefficient.
      if ((current === null && section === 0) || unit.value >= lastBig) return null;
      total += (section + (current ?? 0)) * unit.value;
      lastBig = unit.value;
      section = 0;
    } else {
      if (current === null) return null;
      section += current * unit.value;
    }
    smallest = Math.min(smallest, unit.value);
    current = null;
  }
  const rest = section + (current ?? 0);
  if (rest >= smallest && current !== null) return null;
  const amount = total + rest;
  return amount > 0 ? amount : null;
}

function collectCjkMagnitudeMatches(
  text: string,
  resolveSuffixSymbol: (symbol: string) => Resolution | undefined
): IndexedCurrencyMatch[] {
  const matches: IndexedCurrencyMatch[] = [];
  for (const match of text.matchAll(cjkMagnitudeRegex())) {
    const amount = cjkMagnitudeAmount(match[1]);
    const resolution = resolveSuffixSymbol(match[2]);
    if (amount === null || !resolution) continue;
    matches.push({
      raw: match[0],
      amount,
      currency: resolution.currency,
      start: match.index,
      end: match.index + match[0].length,
      tokenType: "localized-name",
      confidence: 0.9,
      specificity: match[0].length,
      directionPriority: 2,
    });
  }
  return matches;
}

/** The currency written right after a dash price, if any. */
function dashTrailingCurrency(text: string, end: number, context: CurrencyContext | null): { currency: string; length: number } | null {
  const codeRegex = dashTrailingCodeRegex();
  codeRegex.lastIndex = end;
  const code = codeRegex.exec(text);
  if (code && currencyByCode.has(code[1].toUpperCase())) return { currency: code[1].toUpperCase(), length: code[0].length };
  const symbolRegex = dashTrailingSymbolRegex();
  symbolRegex.lastIndex = end;
  const symbol = symbolRegex.exec(text);
  const resolution = symbol ? resolveIdentifier(symbol[1], context) : undefined;
  return symbol && resolution ? { currency: resolution.currency, length: symbol[0].length } : null;
}

function collectDashSuffixMatches(text: string, context: CurrencyContext | null): IndexedCurrencyMatch[] {
  const matches: IndexedCurrencyMatch[] = [];
  for (const match of text.matchAll(dashSuffixPriceRegex())) {
    const amount = normalizeNumberToken(match[1])?.value;
    if (amount === undefined || hasLeadingZero(match[1])) continue;
    const end = match.index + match[0].length;
    // Without a currency after the dash, the page's own currency names it.
    const trailing = dashTrailingCurrency(text, end, context);
    const currency = trailing?.currency ?? context?.currency;
    if (!currency || !currencyByCode.has(currency)) continue;
    matches.push({
      raw: text.slice(match.index, end + (trailing?.length ?? 0)),
      amount,
      currency,
      start: match.index,
      end: end + (trailing?.length ?? 0),
      tokenType: "symbol",
      confidence: trailing ? 0.9 : 0.8,
      specificity: 1,
      // Lowest priority: an explicit currency on the same amount ("CHF 5.–") wins.
      directionPriority: 0,
    });
  }
  return matches;
}

// Range bounds are looked for only next to a price, so a page without one never builds these.
const leadingRangeRegex = lazy(() => new RegExp(
  `${numericStartBoundaryPattern}(${amountPattern})${optionalSpacePattern}${rangeSeparatorPattern}${optionalSpacePattern}$`,
  "u"
));
// The upper bound must end the expression: "$5 - 50 pieces" and "$19.99 -20%" are no ranges.
const trailingRangeRegex = lazy(() => new RegExp(
  `^${optionalSpacePattern}${rangeSeparatorPattern}${optionalSpacePattern}(${amountPattern})(?![\\p{L}\\p{N}_%]|${decimalSeparatorPattern}${digitPattern}|\\s*[\\p{L}%])`,
  "u"
));
// Enough text before a price for the longest lower bound ("1 234 567,89 - ").
const LEADING_RANGE_WINDOW = 48;
// Words that open a range: "from 10 - 20 €", "od 1 500 - 2 700 zł". The
// Romance "de" also means "of" ("Lot de 3 - 12 €") and is left out.
const rangeOpeningWordRegex =
  /(?:^|[^\p{L}])(?:from|between|ab|von|zwischen|desde|entre|dès|od|van|vanaf|fra|från|tra)$/iu;
const writtenNumberRegex = /[0-9٠-٩۰-۹](?:[0-9٠-٩۰-۹.,٬٫'\s\u00a0\u202f]*[0-9٠-٩۰-۹])?/u;

/** "19,99" and "19.99" show cents; "12.500" (a thousands group) and "20" do not. */
function writtenWithCents(token: string): boolean {
  return /[.,٫][0-9٠-٩۰-۹]{1,2}$/u.test(token.trim());
}

/**
 * The bounds of one range are written alike ("10 - 20 €", "9,99 - 19,99 €"):
 * "Gr. 42 - 79,99 €" and "$19.99 - 20" pair different kinds of number.
 */
function boundsWrittenAlike(lower: string, upper: string): boolean {
  return writtenWithCents(lower) === writtenWithCents(upper);
}

/**
 * A lower bound starts the phrase: at the start of the text, after
 * punctuation or after a word that opens a range. A number that ends a name
 * ("iPhone 13 - 450 €", "Pack of 3 - 12,99 €") is no bound.
 */
function opensRange(before: string): boolean {
  const trimmed = before.trimEnd();
  return trimmed === "" || !/[\p{L}\p{N}.]$/u.test(trimmed) || rangeOpeningWordRegex.test(trimmed);
}

/**
 * In "1 500 - 2 700 zł" or "$10 - 20" only one bound names the currency; the
 * other bound of the range shares it.
 */
function inferRangeBounds(text: string, matches: readonly CurrencyMatch[]): CurrencyMatch[] {
  const inferred: CurrencyMatch[] = [];
  const covered = (start: number, end: number) =>
    [...matches, ...inferred].some((match) => start < match.end && match.start < end);

  for (const match of matches) {
    if (iranianCurrencyCodes.has(match.currency) || match.amount <= 0) continue;
    const amountFirst = /^[\s(]*[+\-−]?[0-9٠-٩۰-۹.,]/u.test(match.raw);
    const written = writtenNumberRegex.exec(match.raw)?.[0] ?? match.raw;
    if (amountFirst) {
      // Only the text just before the price can hold its lower bound; a match
      // against the whole prefix would rescan it for every price in the text.
      const windowStart = Math.max(0, match.start - LEADING_RANGE_WINDOW);
      const lower = leadingRangeRegex().exec(text.slice(windowStart, match.start));
      if (!lower) continue;
      const start = windowStart + lower.index;
      const end = start + lower[1].length;
      const amount = normalizeNumberToken(lower[1])?.value;
      if (amount === undefined || amount <= 0 || amount >= match.amount || hasLeadingZero(lower[1]) || covered(start, end)) continue;
      if (!boundsWrittenAlike(lower[1], written) || !opensRange(text.slice(Math.max(0, start - 32), start))) continue;
      inferred.push({ ...match, raw: lower[1], amount, start, end, confidence: match.confidence * 0.95 });
    } else {
      const upper = trailingRangeRegex().exec(text.slice(match.end));
      if (!upper) continue;
      const end = match.end + upper[0].length;
      const start = end - upper[1].length;
      const amount = normalizeNumberToken(upper[1])?.value;
      if (amount === undefined || amount <= match.amount || hasLeadingZero(upper[1]) || covered(start, end)) continue;
      if (!boundsWrittenAlike(written, upper[1])) continue;
      inferred.push({ ...match, raw: upper[1], amount, start, end, confidence: match.confidence * 0.95 });
    }
  }
  return inferred;
}

export function parseCurrencies(
  text: string,
  context: CurrencyContext | null = activeCurrencyContext
): CurrencyMatch[] {
  if (!/[0-9٠-٩۰-۹]/u.test(text)) return [];
  const resolveCode = (code: string): Resolution | undefined => {
    const normalizedCode = code.toUpperCase();
    return currencyByCode.has(normalizedCode)
      ? { currency: normalizedCode, fromContext: false }
      : undefined;
  };
  const resolveSymbol = (symbol: string): Resolution | undefined =>
    resolveIdentifier(symbol, context);
  // "12.99 $" is no USD convention; a shared sign after the amount needs the
  // page's own currency ("12,99 $" on a French-Canadian page). Currency words
  // such as ريال or 元 are written after the amount and keep their default.
  const resolveSuffixSymbol = (symbol: string): Resolution | undefined => {
    const resolution = resolveIdentifier(symbol, context);
    const sharedSign = (identifierCurrencies.get(symbol)?.size ?? 0) > 1 && /^\p{Sc}+$/u.test(symbol);
    return resolution && (!sharedSign || resolution.fromContext) ? resolution : undefined;
  };
  const resolveIranianAlias = (identifier: string): Resolution | undefined => {
    const undecoratedIdentifier = identifier.replace(/ء+$/u, "");
    const currency = iranianIdentifierToCurrency.get(
      normalizeIranianIdentifierKey(undecoratedIdentifier)
    );
    return currency ? { currency, fromContext: false } : undefined;
  };
  const mayHaveCode = isoCodeGuard.test(text);
  const mayBeIranian = iranianTextGuard.test(text);
  const codeMatches = [
    ...(mayHaveCode ? collectMatches(text, codePrefixRegex, 1, 2, resolveCode, "iso", true, "prefix") : []),
    ...(mayHaveCode ? collectMatches(text, codeSuffixRegex, 2, 1, resolveCode, "iso", true, "suffix") : []),
    ...(mayBeIranian ? collectMatches(text, iranianCodePrefixRegex(), 1, 2, resolveCode, "iso", true, "prefix") : []),
    ...(mayBeIranian ? collectMatches(text, iranianCodeSuffixRegex(), 2, 1, resolveCode, "iso", true, "suffix") : []),
  ];
  const symbolMatches = [
    ...collectMatches(text, symbolPrefixRegex, 1, 2, resolveSymbol, "symbol", false, "prefix"),
    ...collectMatches(text, symbolSuffixRegex, 2, 1, resolveSuffixSymbol, "symbol", false, "suffix"),
    ...(unspacedSymbolGuard.test(text)
      ? collectMatches(text, unspacedSymbolSuffixRegex(), 2, 1, resolveSuffixSymbol, "symbol", false, "suffix")
      : []),
    ...(mayBeIranian
      ? collectMatches(text, iranianAliasPrefixRegex(), 1, 2, resolveIranianAlias, "symbol", false, "prefix")
      : []),
    ...(mayBeIranian
      ? collectMatches(text, iranianAliasSuffixRegex(), 2, 1, resolveIranianAlias, "symbol", false, "suffix")
      : []),
    ...(mayBeIranian ? collectPersianMagnitudeMatches(text) : []),
    ...(cjkMagnitudeGuard.test(text) ? collectCjkMagnitudeMatches(text, resolveSuffixSymbol) : []),
    ...(dashSuffixGuard.test(text) ? collectDashSuffixMatches(text, context) : []),
  ];
  const uniqueMatches = new Map<string, IndexedCurrencyMatch>();

  for (const match of [...codeMatches, ...symbolMatches]) {
    const key = `${match.start}\u0000${match.end}\u0000${match.raw}\u0000${match.amount}\u0000${match.currency}`;

    if (!uniqueMatches.has(key)) {
      uniqueMatches.set(key, match);
    }
  }

  // "R 100 R 200", "€ 5 € 10": the middle sign could end the first price or
  // start the second. A suffix reading whose amount an earlier prefix price
  // already claims and whose sign starts the next prefix price is the wrong one
  // ("10 € 20 €" has no earlier prefix price and keeps its suffix reading).
  const allCandidates = [...uniqueMatches.values()];
  const prefixesByCurrency = new Map<string, IndexedCurrencyMatch[]>();
  for (const candidate of allCandidates) {
    if (candidate.directionPriority !== 1) continue;
    const prefixes = prefixesByCurrency.get(candidate.currency) ?? [];
    prefixes.push(candidate);
    prefixesByCurrency.set(candidate.currency, prefixes);
  }
  const candidates = allCandidates.filter((candidate) => {
    const prefixes = candidate.directionPriority === 2 ? prefixesByCurrency.get(candidate.currency) : undefined;
    return !prefixes ||
      !prefixes.some((earlier) => earlier.start < candidate.start && earlier.end > candidate.start) ||
      !prefixes.some((later) => later.start > candidate.start && later.start < candidate.end);
  });
  const resolvedMatches: IndexedCurrencyMatch[] = [];

  for (const candidate of candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.directionPriority - left.directionPriority ||
      (right.end - right.start) - (left.end - left.start) ||
      right.specificity - left.specificity ||
      right.confidence - left.confidence
  )) {
    // Resolved matches never overlap and arrive in start order, so only the
    // last one can overlap a candidate that starts at or after it.
    const overlappingIndex = resolvedMatches.length > 0 &&
      candidate.start < resolvedMatches[resolvedMatches.length - 1].end
      ? resolvedMatches.length - 1
      : -1;

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
      !/^[\s(]*[+\-−]?[0-9٠-٩۰-۹]/u.test(match.raw) ||
      !new RegExp(`^${digitPattern}`, "u").test(text.slice(match.end))
    ) return [];
    return parseCurrencies(text.slice(match.end), context).map((following) => ({
      ...following,
      start: following.start + match.end,
      end: following.end + match.end,
    }));
  });

  const seen = new Set<string>();
  const combined = [...finalMatches, ...sequentialMatches].filter((match) => {
    const key = `${match.start}\u0000${match.end}\u0000${match.currency}\u0000${match.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...combined, ...inferRangeBounds(text, combined)]
    .sort((left, right) => left.start - right.start);
}
