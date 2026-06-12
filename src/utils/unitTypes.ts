export type UnitCategory = "length" | "weight" | "temperature";

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
  | "f";

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
};

export const unitDefinitions: readonly UnitDefinition[] = [
  { code: "mm", category: "length", aliases: ["mm", "millimeter", "millimeters"] },
  { code: "cm", category: "length", aliases: ["cm", "centimeter", "centimeters"] },
  { code: "m", category: "length", aliases: ["m", "meter", "meters"] },
  { code: "km", category: "length", aliases: ["km", "kilometer", "kilometers"] },
  { code: "in", category: "length", aliases: ["in", "inch", "inches"] },
  { code: "ft", category: "length", aliases: ["ft", "foot", "feet"] },
  { code: "yd", category: "length", aliases: ["yd", "yard", "yards"] },
  { code: "mi", category: "length", aliases: ["mi", "mile", "miles"] },
  { code: "mg", category: "weight", aliases: ["mg", "milligram", "milligrams"] },
  { code: "g", category: "weight", aliases: ["g", "gram", "grams"] },
  { code: "kg", category: "weight", aliases: ["kg", "kilogram", "kilograms"] },
  { code: "oz", category: "weight", aliases: ["oz", "ounce", "ounces"] },
  { code: "lb", category: "weight", aliases: ["lb", "lbs", "pound", "pounds"] },
  { code: "c", category: "temperature", aliases: ["c", "°c", "celsius"] },
  { code: "f", category: "temperature", aliases: ["f", "°f", "fahrenheit"] },
];
