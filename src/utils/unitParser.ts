import {
  unitDefinitions,
  type UnitCategory,
  type UnitCode,
  type UnitMatch,
} from "./unitTypes";

type IndexedUnitMatch = UnitMatch & {
  index: number;
};

const aliasDefinitions = new Map<
  string,
  { unit: UnitCode; category: UnitCategory }
>();

for (const definition of unitDefinitions) {
  for (const alias of definition.aliases) {
    aliasDefinitions.set(alias.toLocaleLowerCase(), {
      unit: definition.code,
      category: definition.category,
    });
  }
}

const aliasPattern = [...aliasDefinitions.keys()]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegex)
  .join("|");
const amountPattern = "[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const unitRegex = new RegExp(
  `(?<![\\p{L}\\p{N}_-])(${amountPattern})[\\s\\u00a0\\u202f]*(${aliasPattern})(?![\\p{L}\\p{N}_-])`,
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
  const amount = Number(value.replaceAll(",", ""));
  return Number.isFinite(amount) ? amount : null;
}

export function parseUnits(text: string): UnitMatch[] {
  const searchableText = maskExcludedSegments(text);
  const matches: IndexedUnitMatch[] = [];

  for (const match of searchableText.matchAll(unitRegex)) {
    const amount = parseAmount(match[1]);
    const definition = aliasDefinitions.get(match[2].toLocaleLowerCase());

    if (amount === null || !definition) {
      continue;
    }

    matches.push({
      raw: text.slice(match.index, match.index + match[0].length),
      amount,
      unit: definition.unit,
      category: definition.category,
      index: match.index,
    });
  }

  return matches.map(({ raw, amount, unit, category }) => ({
    raw,
    amount,
    unit,
    category,
  }));
}
