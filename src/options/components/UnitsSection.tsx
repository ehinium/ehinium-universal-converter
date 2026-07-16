import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type { UserSettings } from "../../types/settings";
import { OptionsSection } from "./OptionsSection";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";

type UnitsSectionProps = {
  settings: UserSettings;
  disabled: boolean;
  onSettingChange: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
};

export function UnitsSection({ settings, disabled, onSettingChange }: UnitsSectionProps) {
  return (
    <OptionsSection
      id="units"
      title="Units"
      description="Set the measurement system and optional exact target units."
    >
      <SettingsGroup>
        <SettingsRow
          label="Measurement system"
          description="Auto chooses an appropriate opposite-system unit."
          htmlFor="unit-system"
        >
          <Select
            value={settings.unitSystem}
            disabled={disabled}
            onValueChange={(value) => onSettingChange("unitSystem", value as UserSettings["unitSystem"])}
          >
            <SelectTrigger id="unit-system" className="w-full" aria-describedby="unit-system-description"><SelectValue>{{ auto: "Auto", metric: "Metric", imperial: "Imperial" }[settings.unitSystem]}</SelectValue></SelectTrigger>
            <SelectContent position="popper" collisionPadding={8} className="w-[var(--radix-select-trigger-width)]">
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="metric">Metric</SelectItem>
              <SelectItem value="imperial">Imperial</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Length target"
          description="An exact target overrides the measurement system."
          htmlFor="length-target"
        >
          <Select
            value={settings.targetLengthUnit}
            disabled={disabled}
            onValueChange={(value) => onSettingChange("targetLengthUnit", value as UserSettings["targetLengthUnit"])}
          >
            <SelectTrigger id="length-target" className="w-full" aria-describedby="length-target-description"><SelectValue>{{ auto: "Auto", mm: "Millimeters (mm)", cm: "Centimeters (cm)", m: "Meters (m)", km: "Kilometers (km)", in: "Inches (in)", ft: "Feet (ft)", yd: "Yards (yd)", mi: "Miles (mi)" }[settings.targetLengthUnit]}</SelectValue></SelectTrigger>
            <SelectContent position="popper" collisionPadding={8} className="w-[var(--radix-select-trigger-width)]">
              <SelectItem value="auto">Auto</SelectItem><SelectItem value="mm">Millimeters (mm)</SelectItem><SelectItem value="cm">Centimeters (cm)</SelectItem><SelectItem value="m">Meters (m)</SelectItem><SelectItem value="km">Kilometers (km)</SelectItem><SelectItem value="in">Inches (in)</SelectItem><SelectItem value="ft">Feet (ft)</SelectItem><SelectItem value="yd">Yards (yd)</SelectItem><SelectItem value="mi">Miles (mi)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Weight target" htmlFor="weight-target">
          <Select
            value={settings.targetWeightUnit}
            disabled={disabled}
            onValueChange={(value) => onSettingChange("targetWeightUnit", value as UserSettings["targetWeightUnit"])}
          >
            <SelectTrigger id="weight-target" className="w-full"><SelectValue>{{ auto: "Auto", mg: "Milligrams (mg)", g: "Grams (g)", kg: "Kilograms (kg)", oz: "Ounces (oz)", lb: "Pounds (lb)" }[settings.targetWeightUnit]}</SelectValue></SelectTrigger>
            <SelectContent position="popper" collisionPadding={8} className="w-[var(--radix-select-trigger-width)]">
              <SelectItem value="auto">Auto</SelectItem><SelectItem value="mg">Milligrams (mg)</SelectItem><SelectItem value="g">Grams (g)</SelectItem><SelectItem value="kg">Kilograms (kg)</SelectItem><SelectItem value="oz">Ounces (oz)</SelectItem><SelectItem value="lb">Pounds (lb)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Temperature target" htmlFor="temperature-target">
          <Select
            value={settings.targetTemperatureUnit}
            disabled={disabled}
            onValueChange={(value) => onSettingChange("targetTemperatureUnit", value as UserSettings["targetTemperatureUnit"])}
          >
            <SelectTrigger id="temperature-target" className="w-full"><SelectValue>{{ auto: "Auto", c: "Celsius (deg C)", f: "Fahrenheit (deg F)" }[settings.targetTemperatureUnit]}</SelectValue></SelectTrigger>
            <SelectContent position="popper" collisionPadding={8} className="w-[var(--radix-select-trigger-width)]">
              <SelectItem value="auto">Auto</SelectItem><SelectItem value="c">Celsius (deg C)</SelectItem><SelectItem value="f">Fahrenheit (deg F)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>
    </OptionsSection>
  );
}
