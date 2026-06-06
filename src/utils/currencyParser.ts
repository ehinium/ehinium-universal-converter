import { fiatCurrencies } from "../data/currencies";

export type CurrencyMatch = {
  raw: string;
  amount: number;
  currency: string;
};

type IndexedCurrencyMatch = CurrencyMatch & {
  index: number;
};

const digitPattern = "[0-9٠-٩۰-۹]";
const amountPattern =
  `[+-]?(?:${digitPattern}{1,3}(?:[,.٬]${digitPattern}{3})+|${digitPattern}+)` +
  `(?:[.,٫]${digitPattern}+)?`;
const optionalSpacePattern = "[\\s\\u00a0\\u202f]*";

const currencyByCode = new Map(
  fiatCurrencies.map((currency) => [currency.code, currency])
);

const symbolCurrencies = new Map<string, string[]>();

for (const currency of fiatCurrencies) {
  for (const symbol of currency.symbols) {
    if (symbol === currency.code) {
      continue;
    }

    const codes = symbolCurrencies.get(symbol) ?? [];
    codes.push(currency.code);
    symbolCurrencies.set(symbol, codes);
  }
}

// Bare symbols are inherently ambiguous. These conventional defaults preserve
// useful standalone matches; qualified symbols and ISO codes remain preferable.
const ambiguousSymbolDefaults = new Map<string, string>([
  ["$", "USD"],
  ["£", "GBP"],
  ["¥", "JPY"],
]);
const unsupportedAmbiguousSymbols = new Set(["R", "kr"]);

const symbolToCurrency = new Map<string, string>();

for (const [symbol, codes] of symbolCurrencies) {
  if (unsupportedAmbiguousSymbols.has(symbol)) {
    continue;
  }

  if (codes.length === 1) {
    symbolToCurrency.set(symbol, codes[0]);
    continue;
  }

  const defaultCurrency = ambiguousSymbolDefaults.get(symbol);

  if (defaultCurrency && codes.includes(defaultCurrency)) {
    symbolToCurrency.set(symbol, defaultCurrency);
  }
}

const codePattern = createAlternation([...currencyByCode.keys()]);
const symbolPattern = createAlternation([...symbolToCurrency.keys()]);

const codeRegex = createCurrencyRegex(codePattern, "gu");
const symbolRegex = createCurrencyRegex(symbolPattern, "gu");

function createAlternation(values: string[]): string {
  return values
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join("|");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createCurrencyRegex(identifierPattern: string, flags: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])` +
      `(?:(${identifierPattern})${optionalSpacePattern}(${amountPattern})|` +
      `(${amountPattern})${optionalSpacePattern}(${identifierPattern}))` +
      `(?![\\p{L}\\p{N}_])`,
    flags
  );
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function parseAmount(value: string, decimalDigits: number): number | null {
  let normalized = normalizeDigits(value)
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");

  const sign = normalized.startsWith("-") ? -1 : 1;
  normalized = normalized.replace(/^[+-]/, "");

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  const hasComma = lastComma !== -1;
  const hasDot = lastDot !== -1;

  if (hasComma && hasDot) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized
      .replaceAll(thousandsSeparator, "")
      .replace(decimalSeparator, ".");
  } else if (hasComma || hasDot) {
    const separator = hasComma ? "," : ".";
    const parts = normalized.split(separator);
    const fractionalLength = parts.at(-1)?.length ?? 0;
    const isThousands =
      parts.length > 2 ||
      (fractionalLength === 3 && decimalDigits !== 3);

    normalized = isThousands
      ? parts.join("")
      : `${parts[0]}.${parts.slice(1).join("")}`;
  }

  const amount = sign * Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function collectMatches(
  text: string,
  regex: RegExp,
  resolveCurrency: (identifier: string) => string | undefined
): IndexedCurrencyMatch[] {
  const matches: IndexedCurrencyMatch[] = [];

  for (const match of text.matchAll(regex)) {
    const identifier = match[1] ?? match[4];
    const amountText = match[2] ?? match[3];
    const currency = resolveCurrency(identifier);
    const definition = currency ? currencyByCode.get(currency) : undefined;

    if (!definition) {
      continue;
    }

    const amount = parseAmount(amountText, definition.decimalDigits);

    if (amount === null) {
      continue;
    }

    matches.push({
      raw: match[0],
      amount,
      currency: definition.code,
      index: match.index,
    });
  }

  return matches;
}

export function parseCurrencies(text: string): CurrencyMatch[] {
  const codeMatches = collectMatches(text, codeRegex, (code) =>
    currencyByCode.has(code.toUpperCase()) ? code.toUpperCase() : undefined
  );
  const symbolMatches = collectMatches(text, symbolRegex, (symbol) =>
    symbolToCurrency.get(symbol)
  );
  const uniqueMatches = new Map<string, IndexedCurrencyMatch>();

  for (const match of [...codeMatches, ...symbolMatches]) {
    const key = `${match.raw}\u0000${match.amount}\u0000${match.currency}`;

    if (!uniqueMatches.has(key)) {
      uniqueMatches.set(key, match);
    }
  }

  return [...uniqueMatches.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ raw, amount, currency }) => ({ raw, amount, currency }));
}
