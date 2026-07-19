import type { ReactNode } from "react";
import {
  Camera,
  Code2,
  ExternalLink,
  Mail,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "../../components/ui/card";
import { OptionsSection } from "./OptionsSection";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow, settingsRowLabelClassName } from "./SettingsRow";
import { settingsControlWidths } from "./settings-control-widths";

type AboutLinkProps = {
  href: string;
  icon: ReactNode;
  label: string;
  value: string;
  external?: boolean;
};

function AboutLink({ href, icon, label, value, external = true }: AboutLinkProps) {
  return (
    <a
      href={href}
      aria-label={`${label}: ${value}`}
      className="group flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer noopener" : undefined}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block break-words text-sm font-medium text-foreground">{value}</span>
      </span>
      {external ? <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
    </a>
  );
}

function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.2.1";
  }
}

export function AboutSection() {
  return (
    <OptionsSection
      id="about"
      title="About"
      description="Version and service information for Ehinium Universal Converter."
    >
      <div className="grid gap-5">
        <div className="grid gap-3">
          <h3 className={settingsRowLabelClassName}>Product information</h3>
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
        </div>

        <Card>
          <CardContent className="grid gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <div
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground"
              >
                ER
              </div>
              <div className="min-w-0">
                <p className={settingsRowLabelClassName}>Ehsan Rabipour</p>
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                  Creator
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <AboutLink
                href="mailto:hello@ehsanrp.com"
                icon={<Mail aria-hidden="true" />}
                label="Email"
                value="hello@ehsanrp.com"
                external={false}
              />
              <AboutLink
                href="https://t.me/ehinium"
                icon={<Send aria-hidden="true" />}
                label="Telegram"
                value="@ehinium"
              />
              <AboutLink
                href="https://x.com/ehinium"
                icon={<span aria-hidden="true" className="text-xs font-semibold">X</span>}
                label="X"
                value="@ehinium"
              />
              <AboutLink
                href="https://instagram.com/ehinium"
                icon={<Camera aria-hidden="true" />}
                label="Instagram"
                value="@ehinium"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className={settingsRowLabelClassName}>Project and legal</p>
            <CardDescription>Source code, project details, and privacy information.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <AboutLink
              href="https://github.com/ehinium/ehinium-universal-converter"
              icon={<Code2 aria-hidden="true" />}
              label="GitHub repository"
              value="ehinium/ehinium-universal-converter"
            />
            <AboutLink
              href="https://ehinium.github.io/ehinium-universal-converter/privacy.html"
              icon={<ShieldCheck aria-hidden="true" />}
              label="Privacy policy"
              value="View privacy policy"
            />
          </CardContent>
        </Card>
      </div>
    </OptionsSection>
  );
}
