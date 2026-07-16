import { Separator } from "../components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ManualConversionPanel } from "./components/ManualConversionPanel";
import { PopupFooter } from "./components/PopupFooter";
import { PopupHeader } from "./components/PopupHeader";
import { QuickSettings } from "./components/QuickSettings";
import { SettingSwitchRow } from "./components/SettingSwitchRow";
import { useSettingsController } from "../settings/useSettingsController";

export default function App() {
  const controller = useSettingsController("popup");
  const {
    settings,
    currencies,
    error,
    isLoading,
    isSaving,
    controlsDisabled,
    currentHostname,
    currentSiteIsAllowed,
    manualInput,
    manualResult,
    manualFeedback,
    isManualConverting,
    copyLabel,
    manualInputRef,
    rateStatus,
    settingsApplyStatus,
    showPopupStatus,
    updateSettings,
    updateSetting,
    updateTargetCurrency,
    setCurrentSiteEnabled,
    updateManualInput,
    formatManualInput,
    formatPastedManualInput,
    copyManualResult,
    openOptionsPage,
  } = controller;

  if (isLoading) {
    return (
      <main className="popup-shell bg-background p-4 text-foreground" aria-busy="true">
        <PopupHeader enabled={false} onOpenSettings={openOptionsPage} />
        <Separator className="my-4" />
        <p className="py-6 text-center text-[13px] text-muted-foreground" role="status" aria-live="polite">
          Loading settings...
        </p>
      </main>
    );
  }

  if (!settings || !manualFeedback) {
    return (
      <main className="popup-shell bg-background p-4 text-foreground">
        <PopupHeader enabled={false} onOpenSettings={openOptionsPage} />
        <Separator className="my-4" />
        <Alert variant="destructive">
          <AlertTitle>Settings unavailable</AlertTitle>
          <AlertDescription>{error ?? "Unable to load settings."}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="popup-shell bg-background p-4 text-foreground">
      <PopupHeader enabled={settings.enabled} onOpenSettings={openOptionsPage} />

      <Separator className="my-4" />

      <div className="popup-content grid gap-5">
        <SettingSwitchRow
          id="extension-enabled"
          label="Enable converter"
          description="Apply inline conversions on supported pages."
          checked={settings.enabled}
          disabled={isSaving}
          onCheckedChange={(enabled) => updateSettings({ ...settings, enabled })}
        />

        <QuickSettings
          settings={settings}
          currencies={currencies}
          disabled={controlsDisabled}
          onTargetCurrencyChange={updateTargetCurrency}
          onConversionModeChange={(mode) => updateSetting("converterMode", mode)}
        />

        <ManualConversionPanel
          disabled={controlsDisabled}
          input={manualInput}
          result={manualResult}
          feedback={manualFeedback}
          isConverting={isManualConverting}
          copyLabel={copyLabel}
          inputRef={manualInputRef}
          onInputChange={updateManualInput}
          onBlur={formatManualInput}
          onPaste={formatPastedManualInput}
          onCopy={copyManualResult}
        />

        {currentHostname ? (
          <SettingSwitchRow
            id="current-site-enabled"
            label="Enable on this site"
            description={currentHostname}
            checked={currentSiteIsAllowed}
            disabled={controlsDisabled}
            onCheckedChange={setCurrentSiteEnabled}
          />
        ) : (
          <p className="text-xs leading-4 text-muted-foreground">
            Site controls are unavailable on this page.
          </p>
        )}
      </div>

      {__EUC_DIAGNOSTICS__ ? (
        <>
          <Separator className="my-4" />
          <DiagnosticsPanel />
        </>
      ) : null}

      <Separator className="my-4" />

      <PopupFooter
        rateStatus={rateStatus}
        error={showPopupStatus ? error : null}
        showSaveStatus={showPopupStatus && !error}
        saveStatus={settingsApplyStatus}
      />
    </main>
  );
}
