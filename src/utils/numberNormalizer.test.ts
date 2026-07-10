import { normalizeNumberToken } from "./numberNormalizer";

function expectNumber(
  raw: string,
  expected: {
    value: number;
    decimalSeparator: "." | "," | null;
    groupingSeparators: string[];
  }
): void {
  const actual = normalizeNumberToken(raw);

  if (JSON.stringify(actual) !== JSON.stringify({ raw, ...expected })) {
    throw new Error(
      `${JSON.stringify(raw)}: expected ${JSON.stringify({ raw, ...expected })}, received ${JSON.stringify(actual)}`
    );
  }
}

function expectNull(raw: string): void {
  const actual = normalizeNumberToken(raw);

  if (actual !== null) {
    throw new Error(`${JSON.stringify(raw)}: expected null, received ${JSON.stringify(actual)}`);
  }
}

expectNumber("1 234 567", {
  value: 1234567,
  decimalSeparator: null,
  groupingSeparators: [" "],
});
expectNumber("1,234.56", {
  value: 1234.56,
  decimalSeparator: ".",
  groupingSeparators: [",", "."],
});
expectNumber("1.234,56", {
  value: 1234.56,
  decimalSeparator: ",",
  groupingSeparators: [".", ","],
});
expectNumber("1'234'567.89", {
  value: 1234567.89,
  decimalSeparator: ".",
  groupingSeparators: ["'", "."],
});
expectNumber("1’234’567,89", {
  value: 1234567.89,
  decimalSeparator: ",",
  groupingSeparators: ["’", ","],
});

expectNull("");
expectNull("abc");
expectNull("1..2");
expectNull("1'23'456");
