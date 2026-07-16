import { OptionsSection } from "./OptionsSection";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { settingsControlWidths } from "./settings-control-widths";

function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.1.0";
  }
}

export function AboutSection() {
  return (
    <OptionsSection
      id="about"
      title="About"
      description="Version and service information for Ehinium Universal Converter."
    >
      <SettingsGroup>
        <SettingsRow label="Extension" controlClassName={settingsControlWidths.wide}>
          <p className="text-[13px] text-foreground">Ehinium Universal Converter</p>
        </SettingsRow>
        <SettingsRow label="Version" controlClassName={settingsControlWidths.wide}>
          <p className="text-[13px] tabular-nums text-foreground">{getExtensionVersion()}</p>
        </SettingsRow>
        <SettingsRow label="Exchange-rate providers" controlClassName={settingsControlWidths.wide}>
          <p className="text-[13px] leading-5 text-foreground">
            Frankfurter with Fawaz fallback
          </p>
        </SettingsRow>
      </SettingsGroup>
    </OptionsSection>
  );
}
