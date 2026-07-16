import type { ConverterMode } from "../types/settings";

export const conversionModeOptions: ReadonlyArray<{
  value: ConverterMode;
  label: string;
}> = [
  { value: "currencies", label: "Currency" },
  { value: "units", label: "Units" },
  { value: "everything", label: "Everything" },
];
