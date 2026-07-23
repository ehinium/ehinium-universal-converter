import {
  fiatCurrencies,
  type CurrencyDefinition,
} from "../data/currencies";
import { getCurrencyIdentifierSupport } from "../utils/currencyParser";

export type ExpectedBehavior =
  | "convert"
  | "ignore"
  | "ambiguous"
  | "unsupported";

export type TestCase = {
  id: string;
  category: string;
  currency?: string;
  locale?: string;
  formatId: string;
  sourceText: string;
  expectedBehavior: ExpectedBehavior;
  expectedSourceCurrency?: string;
  expectedAmount?: number;
  expectedMatchCount?: number;
  notes?: string;
};

type CaseTemplate = {
  category: string;
  formatId: string;
  sourceText: (code: string) => string;
  locale?: string;
  amount?: number;
  count?: number;
  notes?: string;
};

const NBSP = "\u00a0";
const NNBSP = "\u202f";

const canonicalTemplates: CaseTemplate[] = [
  { category: "iso", formatId: "iso-suffix", sourceText: (c) => `1,234.56 ${c}`, amount: 1234.56 },
  { category: "iso", formatId: "iso-prefix", sourceText: (c) => `${c} 1,234.56`, amount: 1234.56 },
  { category: "iso", formatId: "iso-prefix-compact", sourceText: (c) => `${c}1,234.56`, amount: 1234.56 },
  { category: "iso", formatId: "iso-suffix-compact", sourceText: (c) => `1,234.56${c}`, amount: 1234.56 },
  { category: "case", formatId: "iso-lowercase", sourceText: (c) => `1,234.56 ${c.toLowerCase()}`, amount: 1234.56 },
  { category: "case", formatId: "iso-mixed-case", sourceText: (c) => `${c[0]}${c.slice(1).toLowerCase()} 1,234.56`, amount: 1234.56 },
  { category: "number", formatId: "european", sourceText: (c) => `1.234,56 ${c}`, amount: 1234.56 },
  { category: "number", formatId: "space-grouping", sourceText: (c) => `1 234 567,89 ${c}`, amount: 1234567.89 },
  { category: "unicode-space", formatId: "nbsp-grouping", sourceText: (c) => `1${NBSP}234${NBSP}567,89 ${c}`, amount: 1234567.89 },
  { category: "unicode-space", formatId: "nnbsp-grouping", sourceText: (c) => `1${NNBSP}234${NNBSP}567,89 ${c}`, amount: 1234567.89 },
  { category: "number", formatId: "apostrophe-grouping", sourceText: (c) => `1'234'567.89 ${c}`, amount: 1234567.89 },
  { category: "number", formatId: "indian-grouping", sourceText: (c) => `12,34,567.89 ${c}`, amount: 1234567.89, notes: "Indian grouping is intentionally tracked even if normalization rejects it." },
  { category: "number", formatId: "integer", sourceText: (c) => `1234 ${c}`, amount: 1234 },
  { category: "number", formatId: "zero", sourceText: (c) => `0 ${c}`, amount: 0 },
  { category: "number", formatId: "decimal", sourceText: (c) => `0.99 ${c}`, amount: 0.99 },
  { category: "number", formatId: "leading-decimal", sourceText: (c) => `.99 ${c}`, amount: 0.99, notes: "Leading decimals are a regression target." },
  { category: "number", formatId: "large", sourceText: (c) => `987,654,321.99 ${c}`, amount: 987654321.99 },
  { category: "sign", formatId: "negative", sourceText: (c) => `-1,234.56 ${c}`, amount: -1234.56 },
  { category: "sign", formatId: "accounting-negative", sourceText: (c) => `(1,234.56 ${c})`, amount: -1234.56, notes: "Accounting negatives must not silently become positive." },
  { category: "sign", formatId: "plus-prefixed", sourceText: (c) => `+1,234.56 ${c}`, amount: 1234.56 },
  { category: "context", formatId: "range", sourceText: (c) => `${c} 10 to ${c} 20`, amount: 10, count: 2 },
  { category: "context", formatId: "approximate", sourceText: (c) => `about ${c} 1,234.56`, amount: 1234.56 },
  { category: "context", formatId: "punctuation", sourceText: (c) => `[${c} 1,234.56],`, amount: 1234.56, notes: "Brackets exercise punctuation; parentheses are reserved for accounting negatives." },
  { category: "context", formatId: "sentence-start", sourceText: (c) => `${c} 1,234.56 is the total.`, amount: 1234.56 },
  { category: "context", formatId: "sentence-end", sourceText: (c) => `The total is 1,234.56 ${c}`, amount: 1234.56 },
  { category: "context", formatId: "multiple-prices", sourceText: (c) => `${c} 10 and ${c} 20`, amount: 10, count: 2 },
  { category: "context", formatId: "currency-and-unit", sourceText: (c) => `${c} 19.99 for 10 kg`, amount: 19.99 },
  { category: "digits", formatId: "persian-digits", sourceText: (c) => `۱٬۲۳۴٫۵۶ ${c}`, amount: 1234.56, locale: "fa" },
  { category: "digits", formatId: "arabic-indic-digits", sourceText: (c) => `١٬٢٣٤٫٥٦ ${c}`, amount: 1234.56, locale: "ar" },
  { category: "digits", formatId: "mixed-script", sourceText: (c) => `۱,234.۵۶ ${c}`, amount: 1234.56, locale: "fa" },
  { category: "direction", formatId: "rtl", sourceText: (c) => `قیمت ۱٬۲۳۴٫۵۶ ${c} است`, amount: 1234.56, locale: "fa" },
  { category: "direction", formatId: "ltr-in-rtl", sourceText: (c) => `السعر ${c} 1,234.56 فقط`, amount: 1234.56, locale: "ar" },
];

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase() || "symbol";
}

function makeCanonicalCases(currency: CurrencyDefinition): TestCase[] {
  return canonicalTemplates.map((template) => ({
    id: `${currency.code.toLowerCase()}-${template.formatId}`,
    category: template.category,
    currency: currency.code,
    locale: template.locale ?? currency.localeExamples[0],
    formatId: template.formatId,
    sourceText: template.sourceText(currency.code),
    expectedBehavior: "convert",
    expectedSourceCurrency: currency.code,
    expectedAmount: template.amount,
    expectedMatchCount: template.count ?? 1,
    notes: template.notes,
  }));
}

function makeSymbolCases(currency: CurrencyDefinition): TestCase[] {
  return currency.symbols
    .filter((symbol) => symbol.toUpperCase() !== currency.code)
    .flatMap((symbol, index) => {
      const support = getCurrencyIdentifierSupport(symbol);
      const ambiguous = support.ambiguous || support.currencies.length > 1;
      const baseBehavior: ExpectedBehavior = ambiguous
        ? "ambiguous"
        : support.prefixCurrency === currency.code
          ? "convert"
          : "unsupported";
      const suffixBehavior: ExpectedBehavior = ambiguous
        ? "ambiguous"
        : support.suffixCurrency === currency.code
          ? "convert"
          : "unsupported";
      const symbolId = `${index + 1}-${slug(symbol)}`;
      const shared = support.currencies.length > 1
        ? `Shared by ${support.currencies.join(", ")}.`
        : undefined;
      const isIranianWordIdentifier =
        (currency.code === "IRT" || currency.code === "IRR") &&
        /\p{L}/u.test(symbol);

      return [
        [
          "symbol-prefix",
          `${symbol}1,234.56`,
          isIranianWordIdentifier ? "unsupported" : baseBehavior,
          isIranianWordIdentifier ? undefined : support.prefixCurrency,
        ],
        ["symbol-prefix-space", `${symbol} 1,234.56`, baseBehavior, support.prefixCurrency],
        ["symbol-prefix-nbsp", `${symbol}${NBSP}1,234.56`, baseBehavior, support.prefixCurrency],
        ["symbol-prefix-nnbsp", `${symbol}${NNBSP}1,234.56`, baseBehavior, support.prefixCurrency],
        ["symbol-suffix", `1,234.56 ${symbol}`, suffixBehavior, support.suffixCurrency],
        ["symbol-suffix-compact", `1,234.56${symbol}`, suffixBehavior, support.suffixCurrency],
      ].map(([formatId, sourceText, expectedBehavior, resolved]) => ({
        id: `${currency.code.toLowerCase()}-${formatId}-${symbolId}`,
        category: ambiguous ? "ambiguous-symbol" : "symbol",
        currency: currency.code,
        locale: currency.localeExamples[0],
        formatId: String(formatId),
        sourceText: String(sourceText),
        expectedBehavior: expectedBehavior as ExpectedBehavior,
        expectedSourceCurrency:
          expectedBehavior === "convert" ? currency.code : resolved as string | undefined,
        expectedAmount: 1234.56,
        expectedMatchCount: expectedBehavior === "convert" ? 1 : 0,
        notes: shared,
      } satisfies TestCase));
    });
}

function makeSpecialCases(): TestCase[] {
  const cases: TestCase[] = [
    { id: "localized-irr-rial", category: "localized-name", currency: "IRR", locale: "fa-IR", formatId: "iranian-rial-name", sourceText: "۱٬۲۳۴ ریال", expectedBehavior: "convert", expectedSourceCurrency: "IRR", expectedAmount: 1234, expectedMatchCount: 1 },
    { id: "localized-irt-toman", category: "localized-name", currency: "IRT", locale: "fa-IR", formatId: "iranian-toman", sourceText: "۱٬۲۳۴ تومان", expectedBehavior: "convert", expectedSourceCurrency: "IRT", expectedAmount: 1234, expectedMatchCount: 1 },
    { id: "overlap-usd-qualified", category: "overlap", currency: "USD", locale: "en-US", formatId: "qualified-dollar", sourceText: "US$ 1,234.56", expectedBehavior: "convert", expectedSourceCurrency: "USD", expectedAmount: 1234.56, expectedMatchCount: 1 },
    { id: "overlap-yen-bare", category: "ambiguous-symbol", formatId: "bare-yen", sourceText: "¥1,234", expectedBehavior: "ambiguous", expectedSourceCurrency: "JPY", expectedAmount: 1234, expectedMatchCount: 0, notes: "Bare ¥ overlaps JPY and CNY; production convention currently defaults to JPY." },
    { id: "overlap-kr-bare", category: "ambiguous-symbol", formatId: "bare-kr", sourceText: "kr 1,234.56", expectedBehavior: "ambiguous", expectedMatchCount: 0, notes: "Shared by DKK, ISK, NOK, and SEK." },
    { id: "overlap-rs-bare", category: "ambiguous-symbol", formatId: "bare-rs", sourceText: "Rs 1,234.56", expectedBehavior: "ambiguous", expectedMatchCount: 0, notes: "Shared by INR, LKR, MUR, NPR, and PKR." },
    { id: "overlap-r-bare", category: "ambiguous-symbol", formatId: "bare-r", sourceText: "R 1,234.56", expectedBehavior: "ambiguous", expectedMatchCount: 0, notes: "Deliberately unsafe bare identifier." },
    { id: "ignore-variable", category: "false-positive", formatId: "code-variable", sourceText: "$variableName", expectedBehavior: "ignore", expectedMatchCount: 0 },
    { id: "ignore-identifier", category: "false-positive", formatId: "identifier", sourceText: "USD_variable 123", expectedBehavior: "ignore", expectedMatchCount: 0 },
    { id: "ignore-version", category: "false-positive", formatId: "version", sourceText: "Version 2.5.1", expectedBehavior: "ignore", expectedMatchCount: 0 },
    { id: "ignore-model", category: "false-positive", formatId: "model", sourceText: "Remote BN59-01312G", expectedBehavior: "ignore", expectedMatchCount: 0 },
    { id: "ignore-percent", category: "false-positive", formatId: "percent", sourceText: "Save 20%", expectedBehavior: "ignore", expectedMatchCount: 0 },
  ];

  return cases;
}

export function generateCurrencyTestMatrix(): TestCase[] {
  const cases = fiatCurrencies.flatMap((currency) => [
    ...makeCanonicalCases(currency),
    ...makeSymbolCases(currency),
  ]);

  return [...cases, ...makeSpecialCases()];
}
