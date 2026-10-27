import {
  localizedInchAliases,
  unitDefinitions,
  unspacedInchAliases,
  type UnitCategory,
  type UnitCode,
  type UnitMatch,
} from "./unitTypes";
import { lazy } from "./lazy";
import { normalizeNumberToken } from "./numberNormalizer";
import type { UnitAmountJoiner } from "./displayFormatting";

type UnitInfo = { unit: UnitCode; category: UnitCategory };

type UnitToken = UnitInfo & {
  /** Where the unit (including spacing or a joining hyphen) starts and ends. */
  start: number;
  end: number;
  text: string;
  kind: "mark" | "word" | "unspaced";
  separation: "attached" | "hyphen" | "space";
};

type Quantity = {
  value: number;
  start: number;
  end: number;
  /** Feet-and-inches like `5'3"` carry their own unit (inches). */
  intrinsicUnit?: UnitInfo;
  /** The literal digits, used to tell grouped thousands from a new number. */
  digits: string;
};

type Component = {
  quantity: Quantity;
  unit?: UnitToken;
  end: number;
};

type ChainKind = "single" | "dimension" | "range";

const DIGIT = "[0-9٠-٩۰-۹]";
const SPACE = "[ \\u00a0\\u202f\\u2009]";
const VULGAR_FRACTIONS: Readonly<Record<string, number>> = {
  "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅕": 1 / 5, "⅖": 2 / 5,
  "⅗": 3 / 5, "⅘": 4 / 5, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8,
};
const VULGAR = Object.keys(VULGAR_FRACTIONS).join("");
// Imperial fractions use these denominators; anything else (12/05) is a date or a ratio.
const FRACTION_DENOMINATORS = new Set([2, 3, 4, 8, 16, 32, 64]);
const INCH: UnitInfo = { unit: "in", category: "length" };
const FOOT: UnitInfo = { unit: "ft", category: "length" };

const aliasDefinitions = new Map<string, UnitInfo>();
for (const definition of unitDefinitions) {
  for (const alias of definition.aliases) {
    aliasDefinitions.set(aliasKey(alias), { unit: definition.code, category: definition.category });
  }
}
for (const alias of [...localizedInchAliases, ...unspacedInchAliases, "型", "v型"]) {
  aliasDefinitions.set(aliasKey(alias), INCH);
}
aliasDefinitions.set("℃", { unit: "c", category: "temperature" });
aliasDefinitions.set("℉", { unit: "f", category: "temperature" });

// Short aliases that mean something else in another letter case: 5G networks,
// size M, the Xiaomi "Mi" brand, size L.
const CASE_SENSITIVE_ALIASES = new Set(["g", "m", "mi", "l"]);
const INCH_MARKS = ["''", "″", '"', "”"];
const FOOT_MARKS = ["′", "'", "’"];

function aliasKey(value: string): string {
  return value.replace(/İ/gu, "i").toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function alternation(values: Iterable<string>): string {
  return [...values].sort((left, right) => right.length - left.length).map(escapeRegex).join("|");
}

const spacedAliases = [
  ...unitDefinitions.flatMap((definition) => definition.aliases),
  ...localizedInchAliases,
  "İnç", "℃", "℉",
];
// Scripts written without spaces between words (Korean particles attach too):
// a unit may run straight into them, as in `125cm幅`, `25℃以下`, `30cm짜리`.
const UNSPACED_SCRIPT_LETTER =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Thai}";
const unspacedScriptLetterRegex = new RegExp(`[${UNSPACED_SCRIPT_LETTER}]`, "u");
// A hyphen may follow a unit when a number follows it, as in the range
// `10kg-20kg`; `30cm-wide` stays one word.
const wordUnitRegex = new RegExp(
  `(?:${SPACE}*|-)(${alternation(spacedAliases)})` +
    `(?![\\p{N}_]|(?![${UNSPACED_SCRIPT_LETTER}])\\p{L}|-(?!${DIGIT}))`,
  "iuy"
);
const unspacedUnitRegex = new RegExp(`${SPACE}*(${alternation([...unspacedInchAliases, "V型", "型"])})`, "iuy");
const attachedInchMarkRegex = new RegExp(`(${alternation(INCH_MARKS)})`, "uy");
const attachedFootMarkRegex = new RegExp(`(${alternation(FOOT_MARKS)})(?![\\p{L}'’′])`, "uy");
// A mark after a space must not open a quotation (`5 "Deluxe"`).
const spacedMarkRegex = new RegExp(`${SPACE}(${alternation([...INCH_MARKS, ...FOOT_MARKS])})(?![\\p{L}\\p{N}])`, "uy");

const quantityRegexes: ReadonlyArray<{ regex: RegExp; parse: (match: RegExpExecArray) => Omit<Quantity, "start" | "end" | "digits"> | null }> = [
  {
    // Feet and inches: 5'3", 5 ' 3 ", 5 ft 3 in, 6′ 2½″
    regex: new RegExp(
      `(${DIGIT}{1,3})${SPACE}?(?:['′’]|ft\\.?|feet|foot)${SPACE}?(?:-${SPACE}?)?` +
      `(${DIGIT}{1,2}(?:[.,]${DIGIT}+)?(?:${SPACE}${DIGIT}{1,2}[/⁄]${DIGIT}{1,2})?|${DIGIT}{1,2}[/⁄]${DIGIT}{1,2}|${DIGIT}{0,2}${SPACE}?[${VULGAR}])` +
      `${SPACE}?(?:''|["″”]|in(?:ch(?:es)?)?\\.?(?![\\p{L}\\p{N}]))`,
      "iuy"
    ),
    parse: (match) => {
      const feet = parseDecimal(match[1]);
      const inches = parseLooseQuantity(match[2]);
      return feet === null || inches === null || inches >= 12
        ? null
        : { value: feet * 12 + inches, intrinsicUnit: INCH };
    },
  },
  {
    // Mixed numbers: 79 1/2, 5-1/2
    regex: new RegExp(`(${DIGIT}{1,4})(?:${SPACE}|-)(${DIGIT}{1,2})[/⁄](${DIGIT}{1,2})(?![/⁄]|${DIGIT})`, "uy"),
    parse: (match) => {
      const whole = parseDecimal(match[1]);
      const fraction = fractionValue(match[2], match[3]);
      return whole === null || fraction === null ? null : { value: whole + fraction };
    },
  },
  {
    // A number followed by a fraction character: 31½, 31 ½
    regex: new RegExp(`(${DIGIT}{1,4})${SPACE}?([${VULGAR}])`, "uy"),
    parse: (match) => {
      const whole = parseDecimal(match[1]);
      return whole === null ? null : { value: whole + VULGAR_FRACTIONS[match[2]] };
    },
  },
  {
    // Simple fractions: 1/4
    regex: new RegExp(`(${DIGIT}{1,2})[/⁄](${DIGIT}{1,2})(?![/⁄]|${DIGIT})`, "uy"),
    parse: (match) => {
      const value = fractionValue(match[1], match[2]);
      return value === null ? null : { value };
    },
  },
  {
    regex: new RegExp(`([${VULGAR}])`, "uy"),
    parse: (match) => ({ value: VULGAR_FRACTIONS[match[1]] }),
  },
  {
    regex: new RegExp(
      `(${DIGIT}{1,3}(?:[ ,.\\u00a0\\u202f\\u2009'’٬]${DIGIT}{3})+(?:[.,٫]${DIGIT}{1,2})?|${DIGIT}+(?:[.,٫]${DIGIT}+)?)`,
      "uy"
    ),
    parse: (match) => {
      const value = parseDecimal(match[1]);
      return value === null ? null : { value };
    },
  },
];

const dimensionSeparatorRegex = new RegExp(`(?:${SPACE}*[x×X*]${SPACE}*|${SPACE}+by${SPACE}+)`, "uy");
// Chinese "to" (至, 到) needs no spaces around it: `80吋至89吋`.
const rangeSeparatorRegex = new RegExp(
  `(?:${SPACE}*[-‐‑‒–—−~～〜至到]${SPACE}*|${SPACE}+(?:to|til|till|bis|a|à|al|até|tot|do|au)${SPACE}+)`,
  "iuy"
);
const labelPrefixRegex = new RegExp(`([WLHDwlhd])${SPACE}?(?=${DIGIT})`, "uy");
const labelSuffixRegex = new RegExp(`${SPACE}?[WLHDwlhd](?![\\p{L}\\p{N}])`, "uy");
const signRegex = /[-−+](?=[0-9٠-٩۰-۹])/uy;
// Letters of scripts that separate words with spaces. A number glued to one of
// them is part of a model name (55UN711, BN59); CJK text has no spaces.
const SPACED_SCRIPT_LETTER =
  "\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Armenian}\\p{Script=Georgian}";
const chainStartRegex = new RegExp(
  `(?<![${SPACED_SCRIPT_LETTER}\\p{N}_/⁄.,#-])(?:[-−+](?=${DIGIT}))?(?:[WLHDwlhd]${SPACE}?)?(?=${DIGIT}|[${VULGAR}])`,
  "gu"
);
// Spaced "in" is the English preposition unless measurement context follows.
const inchWordFollowerRegex = new RegExp(
  `^(?:${SPACE}*$|${SPACE}*[.,;:!?)\\]}"'”’/|·•…]|${SPACE}*[x×*]${SPACE}*${DIGIT}|${SPACE}+` +
  "(?:and|or|by|&|wide|width|long|length|tall|high|height|deep|depth|thick|thickness|dia|diameter|across|w|l|h|d|" +
  "tv|television|screen|display|monitor|laptop|notebook|tablet|led|lcd|oled|qled|uhd|4k|8k|hd|fhd|smart|class|curved)" +
  "(?![\\p{L}\\p{N}]))",
  "iu"
);
// "No. 5", "Nr. 157.777", "#487 in Fashion" are ranks, not measurements.
const rankPrefixRegex = /(?:#|№|\bn[º°o]\.|\bnr\.|\bno\.)\s*$/iu;
// A bare "C" or "F" is more often a model ("Redmi 15C", "iPhone 5C") or cents
// ("99c") than a temperature; it counts only with temperature words nearby.
const BARE_TEMPERATURE_UNIT = /^[CF]$/iu;
const temperatureCueRegex = lazy(() => new RegExp(
  "(?<!\\p{L})(?:temps?|temp[eé]ratur\\p{L}*|heat\\p{L}*|oven\\p{L}*|bak(?:e|ed|es|ing)|roast\\p{L}*|grill\\p{L}*|" +
  "cook\\p{L}*|boil\\p{L}*|simmer\\p{L}*|wash\\p{L}*|launder\\p{L}*|dryer\\p{L}*|tumble|ironing|freez\\p{L}*|frozen|" +
  "fridge\\p{L}*|refrigerat\\p{L}*|thermo\\p{L}*|degrees?|celsius|fahrenheit|sous.vide|fever|melt\\p{L}*|kettle\\p{L}*|" +
  "incubat\\p{L}*|ambient|weather|grad|wasch\\p{L}*|wäsche|backofen|lavag\\p{L}*|lavado|horno|forno|sıcaklı\\p{L}*|" +
  "derece|температур\\p{L}*|градус\\p{L}*|pranie|tvätt\\p{L}*|vask\\p{L}*|دما|درجه|درجة|حرارة)(?!\\p{L})|温度|온도",
  "iu"
));
// "180C/350F", "(350F)": the other scale right next to it.
const pairedTemperatureAfterRegex = /^\s*[/(|=]\s*[-−+]?\d+(?:[.,]\d+)?\s*[°º˚]?\s*[CF](?!\p{L})/u;
const pairedTemperatureBeforeRegex = /[-−+]?\d+(?:[.,]\d+)?\s*[°º˚]?\s*[CF]\s*[/(|=]\s*$/u;
const liquidContextRegex =
  /(?:\bfl\b|\bfluid\b|\bml\b|\beau de\b|\bparfum\b|\bperfume\b|\bcologne\b|\btoilette\b|\bedp\b|\bedt\b|\bbody mist\b)/iu;
const phraseBreakRegex = /[;!?|•\n]|\.(?=\s|$)/u;

/**
 * The phrase a measurement sits in, where a liquid's name or volume would be
 * ("Sauvage EDT 3.4 oz", "3.4 oz / 100 ml"). A sentence before it ("…milk.")
 * or after it ("…order by 5pm EDT") says nothing about it.
 */
function phraseAround(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - 48), start).split(phraseBreakRegex).at(-1) ?? "";
  const after = text.slice(end, end + 16).split(phraseBreakRegex)[0] ?? "";
  return `${before}${text.slice(start, end)}${after}`;
}
const excludedSegmentRegex =
  /<style\b[^>]*>[\s\S]*?<\/style>|<code\b[^>]*>[\s\S]*?<\/code>|<pre\b[^>]*>[\s\S]*?<\/pre>|```[\s\S]*?```|`[^`\r\n]*`/giu;

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function parseDecimal(value: string): number | null {
  return normalizeNumberToken(value)?.value ?? null;
}

function fractionValue(numerator: string, denominator: string): number | null {
  const top = Number(normalizeDigits(numerator));
  const bottom = Number(normalizeDigits(denominator));
  return FRACTION_DENOMINATORS.has(bottom) && top > 0 && top < bottom ? top / bottom : null;
}

/** Inches inside a feet-and-inches value: `3`, `3.5`, `3 1/2`, `1/2`, `2½`, `½`. */
function parseLooseQuantity(value: string): number | null {
  const compact = value.trim();
  const vulgar = compact.at(-1) ?? "";
  if (VULGAR_FRACTIONS[vulgar] !== undefined) {
    const whole = compact.slice(0, -1).trim();
    return (whole ? Number(normalizeDigits(whole)) : 0) + VULGAR_FRACTIONS[vulgar];
  }
  const mixed = /^(\S+)\s+(\S+)[/⁄](\S+)$/u.exec(compact);
  if (mixed) {
    const fraction = fractionValue(mixed[2], mixed[3]);
    return fraction === null ? null : Number(normalizeDigits(mixed[1])) + fraction;
  }
  const fraction = /^(\S+)[/⁄](\S+)$/u.exec(compact);
  if (fraction) return fractionValue(fraction[1], fraction[2]);
  return parseDecimal(compact);
}

function execAt(regex: RegExp, text: string, position: number): RegExpExecArray | null {
  regex.lastIndex = position;
  return regex.exec(text);
}

function parseQuantityAt(text: string, position: number): Quantity | null {
  for (const { regex, parse } of quantityRegexes) {
    const match = execAt(regex, text, position);
    if (!match) continue;
    const parsed = parse(match);
    if (!parsed) continue;
    return { ...parsed, start: position, end: position + match[0].length, digits: match[0] };
  }
  return null;
}

function parseUnitAt(text: string, position: number): UnitToken | null {
  const token = (
    match: RegExpExecArray,
    info: UnitInfo | undefined,
    kind: UnitToken["kind"]
  ): UnitToken | null => {
    if (!info) return null;
    const tokenText = match[1];
    if (CASE_SENSITIVE_ALIASES.has(aliasKey(tokenText)) && tokenText !== aliasKey(tokenText)) return null;
    const leading = match[0].slice(0, match[0].length - tokenText.length);
    return {
      ...info,
      start: position,
      end: position + match[0].length,
      text: tokenText,
      kind,
      separation: leading.includes("-") ? "hyphen" : leading.length > 0 ? "space" : "attached",
    };
  };

  const inchMark = execAt(attachedInchMarkRegex, text, position);
  if (inchMark) return token(inchMark, INCH, "mark");
  const footMark = execAt(attachedFootMarkRegex, text, position);
  if (footMark) return token(footMark, FOOT, "mark");
  const spacedMark = execAt(spacedMarkRegex, text, position);
  if (spacedMark) {
    return token(spacedMark, INCH_MARKS.includes(spacedMark[1]) ? INCH : FOOT, "mark");
  }
  const unspaced = execAt(unspacedUnitRegex, text, position);
  if (unspaced) return token(unspaced, aliasDefinitions.get(aliasKey(unspaced[1])), "unspaced");
  const word = execAt(wordUnitRegex, text, position);
  // A unit hyphenated on both sides belongs to a compound word: `3-in-1`.
  if (word && word[0].startsWith("-") && text[position + word[0].length] === "-") return null;
  // A lone letter running into such text is a model or a name: `5g手机` is a 5G phone.
  if (word && /^\p{L}$/u.test(word[1]) && unspacedScriptLetterRegex.test(text[position + word[0].length] ?? "")) return null;
  if (word) return token(word, aliasDefinitions.get(aliasKey(word[1])), "word");
  return null;
}

function parseComponentAt(text: string, position: number, allowSign: boolean): Component | null {
  let cursor = position;
  let sign = 1;
  const signMatch = allowSign ? execAt(signRegex, text, cursor) : null;
  if (signMatch) {
    sign = signMatch[0] === "+" ? 1 : -1;
    cursor += signMatch[0].length;
  }
  const label = execAt(labelPrefixRegex, text, cursor);
  if (label) cursor += label[0].length;
  const quantity = parseQuantityAt(text, cursor);
  if (!quantity) return null;
  quantity.value *= sign;
  quantity.start = position;
  let end = quantity.end;
  const unit = quantity.intrinsicUnit ? undefined : parseUnitAt(text, end) ?? undefined;
  if (unit) end = unit.end;
  const suffixLabel = execAt(labelSuffixRegex, text, end);
  if (suffixLabel) end += suffixLabel[0].length;
  return { quantity, unit, end };
}

function unitOf(component: Component): UnitInfo | undefined {
  return component.quantity.intrinsicUnit ?? component.unit;
}

function convertLength(value: number, from: UnitCode, to: UnitCode): number {
  return from === to ? value : from === "ft" && to === "in" ? value * 12 : value;
}

/**
 * Inside a quotation (`"iPhone 15"`), a closing `"` is not an inch mark. Quote
 * characters right after a digit (optionally one space) are inch marks and do
 * not open or close quotations.
 */
function isInsideQuotation(text: string, index: number): boolean {
  let open = false;
  for (let position = 0; position < index; position++) {
    if (!/["“”]/u.test(text[position])) continue;
    const before = text.slice(Math.max(0, position - 2), position);
    if (/\p{N}\s?$/u.test(before)) continue;
    open = !open;
  }
  return open;
}

function isPlausibleInchWord(text: string, unit: UnitToken): boolean {
  if (aliasKey(unit.text) !== "in" || unit.separation !== "space") return true;
  return inchWordFollowerRegex.test(text.slice(unit.end));
}

function usesQuoteMark(components: readonly Component[]): boolean {
  return components.some((component) => component.unit?.kind === "mark" && /["”]/u.test(component.unit.text));
}

function isPlausibleTemperature(
  text: string,
  components: readonly Component[],
  values: readonly number[],
  start: number,
  end: number
): boolean {
  const units = components.flatMap((component) => component.unit ? [component.unit.text] : []);
  if (units.some((unit) => !BARE_TEMPERATURE_UNIT.test(unit))) return true;
  if (units.some((unit) => unit !== unit.toUpperCase())) return false;
  // A range alone is no cue: "Seats 10-12 F", "Apt 3-4 F".
  return values.some((value) => value < 0) ||
    pairedTemperatureAfterRegex.test(text.slice(end, end + 24)) ||
    pairedTemperatureBeforeRegex.test(text.slice(Math.max(0, start - 24), start)) ||
    temperatureCueRegex().test(text.slice(Math.max(0, start - 48), end + 40));
}

/** Japanese TV sizes are written 55型 or 55V型; `2型` means "type 2". */
function isPlausibleTypeSize(component: Component): boolean {
  if (!component.unit?.text.includes("型")) return true;
  const value = component.quantity.value;
  return Number.isInteger(value) && value >= 10 && value <= 150;
}

function buildMatch(
  text: string,
  components: Component[],
  kind: ChainKind,
  explicit: boolean
): (UnitMatch & { index: number; end: number }) | null {
  // Trailing numbers without a unit belong to the surrounding text, not the measurement.
  while (components.length > 1 && !unitOf(components.at(-1)!)) components.pop();
  const last = components.at(-1)!;
  const lastUnit = unitOf(last);
  if (!lastUnit) return null;
  if (components.length === 1) kind = "single";
  if (kind === "dimension" && lastUnit.category !== "length") {
    // "2 x 500 g" is a pack count, not a dimension.
    return buildMatch(text, [last], "single", explicit);
  }

  const units = components.map((component) => unitOf(component));
  if (units.some((unit) => unit && unit.category !== lastUnit.category)) return null;
  const distinct = new Set(units.filter((unit): unit is UnitInfo => !!unit).map((unit) => unit.unit));
  let target: UnitInfo = lastUnit;
  if (distinct.size > 1) {
    if ([...distinct].some((unit) => unit !== "in" && unit !== "ft")) return null;
    target = INCH;
  }
  // A bare number before a feet-and-inches value is ambiguous (feet or inches).
  if (components.some((component) => !unitOf(component)) && components.some((component) => component.quantity.intrinsicUnit)) {
    return null;
  }
  const values = components.map((component) => {
    const unit = unitOf(component) ?? lastUnit;
    return convertLength(component.quantity.value, unit.unit, target.unit);
  });

  if (last.unit && !isPlausibleInchWord(text, last.unit)) return null;
  if (!components.every(isPlausibleTypeSize)) return null;
  if (target.category !== "temperature" && values.some((value) => value < 0)) return null;
  if (kind === "range") {
    if (!(values[0] < values[1])) return null;
  } else if (values.some((value) => value === 0)) {
    return null;
  }

  const start = components[0].quantity.start;
  const raw = text.slice(start, last.end).trimEnd();
  if (rankPrefixRegex.test(text.slice(Math.max(0, start - 12), start))) return null;
  if (usesQuoteMark(components) && isInsideQuotation(text, start)) return null;
  if (
    !explicit && target.category === "temperature" &&
    !isPlausibleTemperature(text, components, values, start, start + raw.length)
  ) {
    return null;
  }

  let unit = target.unit;
  let category = target.category;
  if (unit === "oz" && liquidContextRegex.test(phraseAround(text, start, start + raw.length))) {
    unit = "floz";
    category = "volume";
  }

  return {
    raw,
    amount: values[0],
    unit,
    category,
    ...(kind === "dimension" ? { dimensions: values } : {}),
    ...(kind === "range" ? { range: [values[0], values[1]] as const } : {}),
    index: start,
    end: start + raw.length,
  };
}

function parseChainAt(
  text: string,
  position: number,
  explicit: boolean
): (UnitMatch & { index: number; end: number }) | null {
  const first = parseComponentAt(text, position, true);
  if (!first) return null;
  const components = [first];
  let kind = "single" as ChainKind;
  let cursor = first.end;

  // Dimensions chain up to four parts with "x"; a range joins exactly two.
  while (components.length < 4) {
    const dimensionSeparator: RegExpExecArray | null = execAt(dimensionSeparatorRegex, text, cursor);
    const rangeSeparator: RegExpExecArray | null =
      kind === "single" && !dimensionSeparator ? execAt(rangeSeparatorRegex, text, cursor) : null;
    const separator = dimensionSeparator ?? rangeSeparator;
    if (!separator) break;
    const next = parseComponentAt(text, cursor + separator[0].length, false);
    if (!next) break;
    kind = dimensionSeparator ? "dimension" : "range";
    components.push(next);
    cursor = next.end;
    if (kind === "range") break;
  }

  return buildMatch(text, components, kind, explicit);
}

function maskExcludedSegments(text: string): string {
  return text.replace(excludedSegmentRegex, (segment) => " ".repeat(segment.length));
}

/** True when the digits at `start` would continue a grouped number such as `10 000`. */
function continuesGroupedNumber(text: string, start: number): boolean {
  return /[0-9٠-٩۰-۹][ ,.\u00a0\u202f\u2009'’٬]$/u.test(text.slice(Math.max(0, start - 2), start)) &&
    /^[0-9٠-٩۰-۹]{3}(?![0-9٠-٩۰-۹])/u.test(text.slice(start));
}

export type UnitParseOptions = {
  /** Typed or selected by the user to convert: a bare `20 C` is then meant as a temperature. */
  explicit?: boolean;
};

export function parseUnits(text: string, options: UnitParseOptions = {}): UnitMatch[] {
  if (!/[0-9٠-٩۰-۹½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/u.test(text)) return [];
  const searchableText = maskExcludedSegments(text);
  const matches: UnitMatch[] = [];
  let consumedUntil = 0;

  for (const candidate of searchableText.matchAll(chainStartRegex)) {
    const start = candidate.index;
    if (start < consumedUntil || continuesGroupedNumber(searchableText, start)) continue;
    const match = parseChainAt(searchableText, start, options.explicit ?? false);
    if (!match) continue;
    const { index, end, ...unitMatch } = match;
    matches.push({ ...unitMatch, raw: text.slice(index, end) });
    consumedUntil = end;
  }

  return matches;
}

/** The amounts a unit match converts, and how they are joined for display. */
export function unitMatchAmounts(match: UnitMatch): { amounts: readonly number[]; joiner: UnitAmountJoiner } {
  if (match.range) return { amounts: match.range, joiner: "range" };
  return { amounts: match.dimensions ?? [match.amount], joiner: "dimension" };
}
