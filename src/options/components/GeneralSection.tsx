import { Switch } from "../../components/ui/switch";
import { SegmentedControl } from "../../components/SegmentedControl";
import { conversionModeOptions } from "../../settings/conversion-mode-options";
import type { UserSettings } from "../../types/settings";
import { OptionsSection } from "./OptionsSection";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";

type GeneralSectionProps = {
  settings: UserSettings;
  isSaving: boolean;
  controlsDisabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onModeChange: (mode: UserSettings["converterMode"]) => void;
};

export function GeneralSection({
  settings,
  isSaving,
  controlsDisabled,
  onEnabledChange,
  onModeChange,
}: GeneralSectionProps) {
  return (
    <OptionsSection
      id="general"
      title="General"
      description="Turn conversion on or off and choose how broadly it scans pages."
    >
      <SettingsGroup>
        <SettingsRow
          label="Enable converter"
          description="Apply inline conversions on supported pages."
          htmlFor="extension-enabled"
          controlClassName="w-auto"
        >
          <Switch
            id="extension-enabled"
            checked={settings.enabled}
            disabled={isSaving}
            aria-describedby="extension-enabled-description"
            onCheckedChange={onEnabledChange}
          />
        </SettingsRow>
        <SettingsRow
          label="Conversion mode"
          description="Choose whether pages convert currencies, measurements, or both."
        >
          <SegmentedControl
            id="conversion-mode"
            items={conversionModeOptions}
            value={settings.converterMode}
            disabled={controlsDisabled}
            ariaLabel="Conversion mode"
            onValueChange={onModeChange}
          />
        </SettingsRow>
      </SettingsGroup>
    </OptionsSection>
  );
}
