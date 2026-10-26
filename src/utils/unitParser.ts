import {
  unitDefinitions,
  type UnitCategory,
  type UnitCode,
  type UnitMatch,
} from "./unitTypes";
import { normalizeNumberToken } from "./numberNormalizer";

type IndexedUnitMatch = UnitMatch & {
  index: number;
  end: number;
};

type UnitDefinitionMatch = { unit: UnitCode; category: UnitCategory };

const aliasDefinitions = new Map<string, UnitDefinitionMatch>();

for (const definition of unitDefinitions) {
  for (const alias of definition.aliases) {
    aliasDefinitions.set(alias.toLocaleLowerCase(), {
      unit: definition.code,
      category: definition.category,
    });
  }
}

// Inch and foot marks attach directly to the number (`60"`, `6'`). They are
// kept out of the alias table because they are punctuation, not words.
const inchMarks = ["''", "″", '"', "”"];
const footMarks = ["′", "'", "’"];
const markDefinitions = new Map<string, UnitDefinitionMatch>([
  ...inchMarks.map((mark) => [mark, { unit: "in", category: "length" }] as const),
  ...footMarks.map((mark) => [mark, { unit: "ft", category: "length" }] as const),
]);

const aliasPattern = [...aliasDefinitions.keys()]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegex)
  .join("|");
const inchMarkPattern = inchMarks.map(escapeRegex).join("|");
const footMarkPattern = footMarks.map(escapeRegex).join("|");
const digitPattern = "[0-9٠-٩۰-۹]";
const spacePattern = "[\\s\\u00a0\\u202f]";
const groupingSeparatorPattern = "[ ,.\\u00a0\\u202f\\u2009'’٬]";
const decimalSeparatorPattern = "[.,٫]";
const amountPattern =
  `[+-]?(?:${digitPattern}{1,3}(?:${groupingSeparatorPattern}${digitPattern}{3})+` +
  `(?:${decimalSeparatorPattern}${digitPattern}{1,2})?|${digitPattern}+` +
  `(?:${decimalSeparatorPattern}${digitPattern}+)?)`;
const numericStartBoundaryPattern =
  `(?<![\\p{L}\\p{N}_-])(?<!${digitPattern}${groupingSeparatorPattern})`;
// `144 inch`, `144-Inch`, `60"`, `6'` (but not `90's`).
const unitPattern =
  `(?:${spacePattern}*|-)(?:${aliasPattern})(?![\\p{L}\\p{N}_-])` +
  `|(?:${inchMarkPattern})` +
  `|(?:${footMarkPattern})(?![\\p{L}'’′])`;
// Amazon-style W/L/H/D labels after a dimension component: `60" W x 84" L`.
const dimensionLabelPattern = `(?:${spacePattern}*[WLHDwlhd](?![\\p{L}\\p{N}]))?`;
const dimensionSeparatorPattern = `${spacePattern}*[x×X]${spacePattern}*`;
const dimensionComponentPattern =
  `(${amountPattern})(${unitPattern})?${dimensionLabelPattern}`;
const unitRegex = new RegExp(
  `${numericStartBoundaryPattern}(${amountPattern})(${unitPattern})`,
  "giu"
);
const dimensionRegex = new RegExp(
  `${numericStartBoundaryPattern}${dimensionComponentPattern}` +
  `${dimensionSeparatorPattern}${dimensionComponentPattern}` +
  `(?:${dimensionSeparatorPattern}${dimensionComponentPattern})?`,
  "giu"
);
const excludedSegmentRegex =
  /<style\b[^>]*>[\s\S]*?<\/style>|<code\b[^>]*>[\s\S]*?<\/code>|<pre\b[^>]*>[\s\S]*?<\/pre>|```[\s\S]*?```|`[^`\r\n]*`/giu;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function maskExcludedSegments(text: string): string {
  return text.replace(excludedSegmentRegex, (segment) => " ".repeat(segment.length));
}

function parseAmount(value: string): number | null {
  return normalizeNumberToken(value)?.value ?? null;
}

function resolveUnit(token: string): UnitDefinitionMatch | undefined {
  const normalized = token.replace(/^[\s\u00a0\u202f-]+/u, "");
  return markDefinitions.get(normalized) ??
    aliasDefinitions.get(normalized.toLocaleLowerCase());
}

function isQuoteMark(token: string): boolean {
  return /^[\s\u00a0\u202f]*["”]$/u.test(token);
}

/**
 * A `"` after a number is an inch mark unless it closes a quotation, as in
 * `"iPhone 15"`. Quote characters that follow a digit are inch marks and do
 * not open or close quotations.
 */
function isInsideQuotation(text: string, index: number): boolean {
  let open = false;
  for (let position = 0; position < index; position++) {
    if (/["“”]/u.test(text[position]) && !/\p{N}/u.test(text[position - 1] ?? "")) {
      open = !open;
    }
  }
  return open;
}

function parseDimensions(text: string, searchableText: string): IndexedUnitMatch[] {
  const matches: IndexedUnitMatch[] = [];

  for (const match of searchableText.matchAll(dimensionRegex)) {
    const components: { amount: string; unit?: string }[] = [];
    for (let group = 1; group < match.length; group += 2) {
      if (match[group] !== undefined) {
        components.push({ amount: match[group], unit: match[group + 1] });
      }
    }

    const last = components.at(-1);
    const definition = last?.unit ? resolveUnit(last.unit) : undefined;
    if (!definition || definition.category !== "length") {
      continue;
    }

    const amounts = components.map((component) => parseAmount(component.amount));
    const unitsAgree = components.every(
      (component) => !component.unit || resolveUnit(component.unit)?.unit === definition.unit
    );
    if (!unitsAgree || amounts.some((amount) => amount === null)) {
      continue;
    }
    if (components.some((component) => component.unit && isQuoteMark(component.unit)) &&
        isInsideQuotation(searchableText, match.index)) {
      continue;
    }

    const raw = text.slice(match.index, match.index + match[0].length).trimEnd();
    matches.push({
      raw,
      amount: amounts[0] as number,
      unit: definition.unit,
      category: definition.category,
      dimensions: amounts as number[],
      index: match.index,
      end: match.index + raw.length,
    });
  }

  return matches;
}

export function parseUnits(text: string): UnitMatch[] {
  const searchableText = maskExcludedSegments(text);
  const matches = parseDimensions(text, searchableText);
  const dimensionSpans = [...matches];

  for (const match of searchableText.matchAll(unitRegex)) {
    const end = match.index + match[0].length;
    if (dimensionSpans.some((span) => match.index < span.end && end > span.index)) {
      continue;
    }

    const amount = parseAmount(match[1]);
    const definition = resolveUnit(match[2]);

    if (amount === null || !definition) {
      continue;
    }
    if (isQuoteMark(match[2]) && isInsideQuotation(searchableText, match.index)) {
      continue;
    }

    matches.push({
      raw: text.slice(match.index, end),
      amount,
      unit: definition.unit,
      category: definition.category,
      index: match.index,
      end,
    });
  }

  return matches
    .sort((left, right) => left.index - right.index)
    .map(({ raw, amount, unit, category, dimensions }) => ({
      raw,
      amount,
      unit,
      category,
      ...(dimensions ? { dimensions } : {}),
    }));
}
