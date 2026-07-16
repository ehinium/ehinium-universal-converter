import { Field, FieldLabel } from "../../components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { SegmentedControl } from "../../components/SegmentedControl";
import { conversionModeOptions } from "../../settings/conversion-mode-options";
import type { UserSettings } from "../../types/settings";

type Currency = { code: string; name: string };

type QuickSettingsProps = {
  settings: UserSettings;
  currencies: readonly Currency[];
  disabled: boolean;
  onTargetCurrencyChange: (value: string) => void;
  onConversionModeChange: (value: UserSettings["converterMode"]) => void;
};

export function QuickSettings({
  settings,
  currencies,
  disabled,
  onTargetCurrencyChange,
  onConversionModeChange,
}: QuickSettingsProps) {
  const selectedCurrency = currencies.find((currency) => currency.code === settings.targetCurrency);

  return (
    <section className="grid gap-5" aria-label="Quick settings">
      <Field className="gap-2">
        <FieldLabel htmlFor="target-currency">Target currency</FieldLabel>
        <Select
          value={settings.targetCurrency}
          disabled={disabled}
          onValueChange={onTargetCurrencyChange}
        >
          <SelectTrigger id="target-currency" className="w-full">
            <SelectValue>
              {selectedCurrency
                ? `${selectedCurrency.code} - ${selectedCurrency.name}`
                : settings.targetCurrency}
            </SelectValue>
          </SelectTrigger>
          {/* Chrome popups need a stable cap and collision inset inside their fixed document. */}
          <SelectContent
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className="z-(--layer-dropdown) max-h-[min(20rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)]"
          >
            {currencies.map((currency) => (
              <SelectItem key={currency.code} value={currency.code}>
                {currency.code} - {currency.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field className="gap-2">
        <FieldLabel id="conversion-mode-label">Conversion mode</FieldLabel>
        <SegmentedControl
          id="conversion-mode"
          items={conversionModeOptions}
          value={settings.converterMode}
          disabled={disabled}
          ariaLabelledBy="conversion-mode-label"
          onValueChange={onConversionModeChange}
        />
      </Field>
    </section>
  );
}
