import { DomainListField } from "../../settings/components/DomainListField";
import type { UserSettings } from "../../types/settings";
import { OptionsSection } from "./OptionsSection";
import { SettingsGroup } from "./SettingsGroup";

type WebsiteRulesSectionProps = {
  settings: UserSettings;
  whitelistDraft: string;
  blacklistDraft: string;
  disabled: boolean;
  onDomainsChange: (key: "whitelist" | "blacklist", value: string) => void;
};

export function WebsiteRulesSection({
  settings,
  whitelistDraft,
  blacklistDraft,
  disabled,
  onDomainsChange,
}: WebsiteRulesSectionProps) {
  return (
    <OptionsSection
      id="website-rules"
      title="Website rules"
      description="Choose where inline conversions may appear. Enter one domain per line."
    >
      <SettingsGroup>
        <DomainListField
          id="whitelist-domains"
          label="Always enable on these sites"
          count={settings.whitelist.length}
          value={whitelistDraft}
          disabled={disabled}
          placeholder={"amazon.com\nebay.co.uk"}
          description="When populated, conversions run only on these domains."
          onChange={(value) => onDomainsChange("whitelist", value)}
        />
        <DomainListField
          id="blacklist-domains"
          label="Always disable on these sites"
          count={settings.blacklist.length}
          value={blacklistDraft}
          disabled={disabled}
          placeholder="example.com"
          description="Conversions never run on these domains."
          onChange={(value) => onDomainsChange("blacklist", value)}
        />
      </SettingsGroup>
    </OptionsSection>
  );
}
