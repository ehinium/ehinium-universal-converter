export type UnitCategory = "length" | "weight" | "temperature" | "volume";

export type UnitCode =
  | "mm"
  | "cm"
  | "m"
  | "km"
  | "in"
  | "ft"
  | "yd"
  | "mi"
  | "mg"
  | "g"
  | "kg"
  | "oz"
  | "lb"
  | "c"
  | "f"
  | "ml"
  | "cl"
  | "l"
  | "floz"
  | "gal";

export type UnitDefinition = {
  code: UnitCode;
  category: UnitCategory;
  aliases: readonly string[];
};

export type UnitMatch = {
  raw: string;
  amount: number;
  unit: UnitCode;
  category: UnitCategory;
  /** Every amount of a dimension expression such as `60" x 84"`; `amount` is the first. */
  dimensions?: readonly number[];
  /** Lower and upper bound of a range such as `30 to 49 in`; `amount` is the lower bound. */
  range?: readonly [number, number];
};

export const unitDefinitions: readonly UnitDefinition[] = [
  { code: "mm", category: "length", aliases: ["mm", "millimeter", "millimeters", "millimetre", "millimetres"] },
  { code: "cm", category: "length", aliases: ["cm", "centimeter", "centimeters", "centimetre", "centimetres"] },
  { code: "m", category: "length", aliases: ["m", "meter", "meters", "metre", "metres"] },
  { code: "km", category: "length", aliases: ["km", "kilometer", "kilometers", "kilometre", "kilometres"] },
  { code: "in", category: "length", aliases: ["in", "inch", "inches"] },
  { code: "ft", category: "length", aliases: ["ft", "foot", "feet"] },
  { code: "yd", category: "length", aliases: ["yd", "yard", "yards"] },
  { code: "mi", category: "length", aliases: ["mi", "mile", "miles"] },
  { code: "mg", category: "weight", aliases: ["mg", "milligram", "milligrams"] },
  { code: "g", category: "weight", aliases: ["g", "gram", "grams"] },
  { code: "kg", category: "weight", aliases: ["kg", "kilogram", "kilograms"] },
  { code: "oz", category: "weight", aliases: ["oz", "ounce", "ounces"] },
  { code: "lb", category: "weight", aliases: ["lb", "lbs", "pound", "pounds"] },
  {
    code: "c",
    category: "temperature",
    aliases: ["c", "°c", "° c", "ºc", "º c", "˚c", "celsius", "degrees c", "degree c", "deg c", "degrees celsius", "degree celsius"],
  },
  {
    code: "f",
    category: "temperature",
    aliases: ["f", "°f", "° f", "ºf", "º f", "˚f", "fahrenheit", "degrees f", "degree f", "deg f", "degrees fahrenheit", "degree fahrenheit"],
  },
  { code: "ml", category: "volume", aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
  { code: "cl", category: "volume", aliases: ["cl", "centiliter", "centiliters", "centilitre", "centilitres"] },
  { code: "l", category: "volume", aliases: ["l", "ltr", "liter", "liters", "litre", "litres"] },
  { code: "floz", category: "volume", aliases: ["fl oz", "fl. oz", "fl.oz", "fl oz.", "fl. oz.", "fluid ounce", "fluid ounces", "oz fl"] },
  { code: "gal", category: "volume", aliases: ["gal", "gallon", "gallons"] },
];

/** Words for "inch" in other languages and scripts, matched like the English aliases. */
export const localizedInchAliases: readonly string[] = [
  "zoll", "pulgadas", "pulgada", "pulg", "polegadas", "polegada", "pollici", "pollice",
  "pouces", "pouce", "cali", "palců", "palce", "palcov", "tum", "tommer", "tomme",
  "tuumaa", "tuuman", "tuuma", "inci", "inç", "дюймов", "дюйма", "дюйм", "дюймів",
  "ίντσες", "ιντσών", "اینچی", "اینچ", "بوصة", "بوصه", "إنش", "انش", "אינץ'", "אינץ׳",
];

/**
 * Inch words in scripts written without spaces between words. Text may follow
 * them directly (`55インチ液晶`), so they do not need a trailing word boundary.
 */
export const unspacedInchAliases: readonly string[] = ["インチ", "英寸", "吋", "인치", "นิ้ว", "इंच"];
