import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type { ExchangeRateStatus } from "../../services/rates";
import { RateStatus } from "../../settings/components/RateStatus";
import { OptionsSection } from "./OptionsSection";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { settingsControlWidths } from "./settings-control-widths";

type Currency = { code: string; name: string };

type CurrenciesSectionProps = {
  targetCurrency: string;
  currencies: readonly Currency[];
  rateStatus: ExchangeRateStatus;
  isRefreshingRates: boolean;
  disabled: boolean;
  onTargetCurrencyChange: (currency: string) => void;
  onRefreshRates: () => void;
};

export function CurrenciesSection({
  targetCurrency,
  currencies,
  rateStatus,
  isRefreshingRates,
  disabled,
  onTargetCurrencyChange,
  onRefreshRates,
}: CurrenciesSectionProps) {
  const selectedCurrency = currencies.find((currency) => currency.code === targetCurrency);

  return (
    <OptionsSection
      id="currencies"
      title="Currencies"
      description="Choose the target currency and review the exchange-rate source."
    >
      <SettingsGroup>
        <SettingsRow
          label="Target currency"
          description="Detected prices are converted to this currency."
          htmlFor="target-currency"
          controlClassName={settingsControlWidths.wide}
        >
          <Select
            value={targetCurrency}
            disabled={disabled}
            onValueChange={onTargetCurrencyChange}
          >
            <SelectTrigger id="target-currency" className="w-full" aria-describedby="target-currency-description">
              <SelectValue>
                {selectedCurrency
                  ? `${selectedCurrency.code} - ${selectedCurrency.name}`
                  : targetCurrency}
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" collisionPadding={8} className="w-[var(--radix-select-trigger-width)]">
              {currencies.map((currency) => (
                <SelectItem key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Exchange rates"
          description="Rates load on demand and are cached temporarily."
          controlClassName={settingsControlWidths.wide}
        >
          <RateStatus
            status={rateStatus}
            isRefreshing={isRefreshingRates}
            disabled={disabled}
            onRefresh={onRefreshRates}
          />
        </SettingsRow>
      </SettingsGroup>
    </OptionsSection>
  );
}
