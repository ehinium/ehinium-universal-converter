import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { AppearanceSection } from "./components/AppearanceSection";
import { AboutSection } from "./components/AboutSection";
import { CurrenciesSection } from "./components/CurrenciesSection";
import { GeneralSection } from "./components/GeneralSection";
import { OptionsHeader } from "./components/OptionsHeader";
import {
  OptionsNavigation,
} from "./components/OptionsNavigation";
import { navigationItems, type OptionsSectionId } from "./components/options-navigation";
import { UnitsSection } from "./components/UnitsSection";
import { WebsiteRulesSection } from "./components/WebsiteRulesSection";
import { useSettingsController } from "../settings/useSettingsController";

export default function App() {
  const [activeSection, setActiveSection] = useState<OptionsSectionId>("general");
  const controller = useSettingsController("options");
  const {
    settings,
    currencies,
    whitelistDraft,
    blacklistDraft,
    error,
    isLoading,
    isSaving,
    controlsDisabled,
    rateStatus,
    isRefreshingRates,
    settingsApplyStatus,
    updateSettings,
    updateSetting,
    updateTargetCurrency,
    updateDomains,
    refreshRates,
  } = controller;
  const settingsReady = !isLoading && settings !== null;

  useEffect(() => {
    if (!settingsReady || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const sectionId = visibleEntry?.target.id as OptionsSectionId | undefined;
        if (sectionId) setActiveSection(sectionId);
      },
      {
        root: null,
        rootMargin: "-15% 0px -70% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    for (const { id } of navigationItems) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }

    return () => observer.disconnect();
  }, [settingsReady]);

  function selectSection(section: OptionsSectionId): void {
    setActiveSection(section);
    const target = document.getElementById(section);
    if (!target) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  return (
    <main className="options-page min-h-screen bg-background text-foreground">
      <OptionsHeader />
      <div className="mx-auto grid w-full max-w-[1120px] gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[192px_minmax(0,1fr)] lg:gap-10 lg:py-8">
        <OptionsNavigation
          activeSection={activeSection}
          onSectionSelect={selectSection}
        />
        <div className="min-w-0 w-full max-w-[780px]">
          {isLoading ? (
            <div className="rounded-xl border bg-card py-8 text-center text-muted-foreground" role="status" aria-live="polite">
              Loading settings...
            </div>
          ) : settings ? (
            <>
              {error ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : (
                <p className="mb-4 min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">
                  {settingsApplyStatus}
                </p>
              )}
              <div className="grid gap-12">
                <GeneralSection
                  settings={settings}
                  isSaving={isSaving}
                  controlsDisabled={controlsDisabled}
                  onEnabledChange={(enabled) => updateSettings({ ...settings, enabled })}
                  onModeChange={(mode) => updateSetting("converterMode", mode)}
                />
                <CurrenciesSection
                  targetCurrency={settings.targetCurrency}
                  currencies={currencies}
                  rateStatus={rateStatus}
                  isRefreshingRates={isRefreshingRates}
                  disabled={controlsDisabled}
                  onTargetCurrencyChange={updateTargetCurrency}
                  onRefreshRates={refreshRates}
                />
                <UnitsSection
                  settings={settings}
                  disabled={controlsDisabled}
                  onSettingChange={updateSetting}
                />
                <WebsiteRulesSection
                  settings={settings}
                  whitelistDraft={whitelistDraft}
                  blacklistDraft={blacklistDraft}
                  disabled={controlsDisabled}
                  onDomainsChange={updateDomains}
                />
                <AppearanceSection
                  settings={settings}
                  disabled={controlsDisabled}
                  onSettingChange={updateSetting}
                />
                <AboutSection />
              </div>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Settings unavailable</AlertTitle>
              <AlertDescription>{error ?? "Unable to load settings."}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </main>
  );
}
