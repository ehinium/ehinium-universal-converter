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
import { settingsControlWidths } from "./settings-control-widths";
import { ThemePreferenceControl } from "./ThemePreferenceControl";

type AppearanceSectionProps = {
  settings: UserSettings;
  disabled: boolean;
  onSettingChange: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
};

export function AppearanceSection({
  settings,
  disabled,
  onSettingChange,
}: AppearanceSectionProps) {
  return (
    <OptionsSection
      id="appearance"
      title="Appearance"
      description="Choose the interface theme and how inline conversion badges are displayed."
    >
      <SettingsGroup>
        <SettingsRow
          label="Theme"
          description="System follows your operating-system appearance."
        >
          <ThemePreferenceControl />
        </SettingsRow>
        <SettingsRow label="Badge style" htmlFor="badge-style" controlClassName={settingsControlWidths.short}>
          <Select value={settings.badgeStyle} disabled={disabled} onValueChange={(value) => onSettingChange("badgeStyle", value as UserSettings["badgeStyle"])}>
            <SelectTrigger id="badge-style" className="w-full"><SelectValue>{settings.badgeStyle === "default" ? "Default" : settings.badgeStyle === "compact" ? "Compact" : "Minimal"}</SelectValue></SelectTrigger>
            <SelectContent position="popper" collisionPadding={8} className="w-[var(--radix-select-trigger-width)]">
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
              <SelectItem value="minimal">Minimal</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Badge visibility" htmlFor="badge-visibility" controlClassName={settingsControlWidths.short}>
          <Select value={settings.badgeVisibility} disabled={disabled} onValueChange={(value) => onSettingChange("badgeVisibility", value as UserSettings["badgeVisibility"])}>
            <SelectTrigger id="badge-visibility" className="w-full"><SelectValue>{settings.badgeVisibility === "always" ? "Always show" : "Show on hover"}</SelectValue></SelectTrigger>
            <SelectContent position="popper" collisionPadding={8} className="w-[var(--radix-select-trigger-width)]">
              <SelectItem value="always">Always show</SelectItem>
              <SelectItem value="hover">Show on hover</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>
    </OptionsSection>
  );
}
