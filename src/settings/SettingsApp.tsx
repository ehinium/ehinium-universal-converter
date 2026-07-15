import type { UserSettings } from "../types/settings";
import { DiagnosticsPanel } from "../popup/DiagnosticsPanel";
import { CompactSelect } from "./components/CompactSelect";
import { DomainListField } from "./components/DomainListField";
import { ManualConverter } from "./components/ManualConverter";
import { RateStatus } from "./components/RateStatus";
import { SelectSetting } from "./components/SelectSetting";
import { SettingsSection } from "./components/SettingsSection";
import { ToggleSetting } from "./components/ToggleSetting";
import {
  useSettingsController,
  type SettingsSurface,
} from "./useSettingsController";

export type { SettingsSurface } from "./useSettingsController";

type SettingsAppProps = {
  surface: SettingsSurface;
};

export function SettingsApp({ surface }: SettingsAppProps) {
  const controller = useSettingsController(surface);
  const {
    settings,
    currencies,
    whitelistDraft,
    blacklistDraft,
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
    isRefreshingRates,
    settingsApplyStatus,
    showPopupStatus,
    updateSettings,
    updateSetting,
    updateTargetCurrency,
    updateDomains,
    setCurrentSiteEnabled,
    updateManualInput,
    formatManualInput,
    formatPastedManualInput,
    copyManualResult,
    refreshRates,
    openOptionsPage,
  } = controller;

  const pageClassName = `settings-page settings-page--${surface}`;
  const surfaceEyebrow = "Ehinium Universal Converter";
  const pageTitle = surface === "popup" ? "Converter" : "Settings";

  if (isLoading) {
    return (
      <main className={pageClassName} aria-busy="true">
        <header className="settings-header">
          <p className="eyebrow">{surfaceEyebrow}</p>
          <h1>{pageTitle}</h1>
        </header>
        <div className="loading-panel" role="status" aria-live="polite">
          Loading settings...
        </div>
      </main>
    );
  }

  if (!settings || !manualFeedback) {
    return (
      <main className={pageClassName}>
        <header className="settings-header">
          <p className="eyebrow">{surfaceEyebrow}</p>
          <h1>Settings unavailable</h1>
        </header>
        <div className="loading-panel loading-panel--error" role="alert">
          {error ?? "Unable to load settings."}
        </div>
      </main>
    );
  }

  const targetCurrencyControl = (
    <SelectSetting
      id="target-currency"
      label="Target currency"
      value={settings.targetCurrency}
      disabled={controlsDisabled}
      onChange={(event) => updateTargetCurrency(event.currentTarget.value)}
    >
      {currencies.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.code} - {currency.name}
        </option>
      ))}
    </SelectSetting>
  );

  const conversionModeControl = (
    <SelectSetting
      id="conversion-mode"
      label="Conversion mode"
      description="Currency-only mode is lighter; everything also converts measurements."
      value={settings.converterMode}
      disabled={controlsDisabled}
      onChange={(event) =>
        updateSetting(
          "converterMode",
          event.currentTarget.value as UserSettings["converterMode"]
        )
      }
    >
      <option value="currencies">Currencies only</option>
      <option value="units">Units only</option>
      <option value="everything">Everything</option>
    </SelectSetting>
  );

  const manualConversionControl = (
    <ManualConverter
      value={manualInput}
      result={manualResult}
      feedback={manualFeedback}
      isConverting={isManualConverting}
      disabled={controlsDisabled}
      copyLabel={copyLabel}
      inputRef={manualInputRef}
      onChange={updateManualInput}
      onBlur={formatManualInput}
      onPaste={formatPastedManualInput}
      onCopy={copyManualResult}
    />
  );

  if (surface === "popup") {
    return (
      <main className={pageClassName}>
        <header className="settings-header">
          <p className="eyebrow">{surfaceEyebrow}</p>
          <h1>{pageTitle}</h1>
        </header>

        <div className="settings-surface popup-surface">
          <div className="popup-block">
            <ToggleSetting
              id="extension-enabled"
              label="Enable converter"
              description="Apply inline conversions on supported pages."
              checked={settings.enabled}
              disabled={isSaving}
              onChange={(enabled) =>
                updateSettings({ ...settings, enabled })
              }
            />
          </div>

          <div className="popup-block popup-fields">
            {targetCurrencyControl}
            {conversionModeControl}
          </div>

          <section className="popup-block popup-manual" aria-labelledby="popup-manual-title">
            <div className="section-heading">
              <h2 id="popup-manual-title">Manual conversion</h2>
            </div>
            <div className="section-content">{manualConversionControl}</div>
          </section>

          <div className="popup-block">
            {currentHostname ? (
              <ToggleSetting
                id="current-site-enabled"
                label="Enable on this site"
                description={currentHostname}
                checked={currentSiteIsAllowed}
                disabled={controlsDisabled}
                onChange={setCurrentSiteEnabled}
              />
            ) : (
              <p className="site-unavailable">Site controls are unavailable on this page.</p>
            )}
          </div>

          {__EUC_DIAGNOSTICS__ ? <DiagnosticsPanel /> : null}

          <div className="popup-block">
            <button
              className="button button--primary button--wide"
              type="button"
              onClick={openOptionsPage}
            >
              Open settings
            </button>
          </div>
        </div>

        {showPopupStatus ? (
          error ? (
            <p className="save-status save-status--error" role="alert">
              {error}
            </p>
          ) : (
            <p className="save-status" role="status" aria-live="polite">
              {settingsApplyStatus}
            </p>
          )
        ) : null}
      </main>
    );
  }

  return (
    <main className={pageClassName}>
      <header className="settings-header">
        <p className="eyebrow">{surfaceEyebrow}</p>
        <h1>{pageTitle}</h1>
        <p className="header-subtitle">
          Keep conversions readable, accurate, and limited to the places where
          you want them.
        </p>
      </header>

      <div className="settings-surface">
        <SettingsSection
          id="general"
          title="General"
          description="Turn conversion on or off and choose how broadly it scans pages."
        >
          <ToggleSetting
            id="extension-enabled"
            label="Enable converter"
            description="Apply inline conversions on supported pages."
            checked={settings.enabled}
            disabled={isSaving}
            onChange={(enabled) => updateSettings({ ...settings, enabled })}
          />
          {conversionModeControl}
        </SettingsSection>

        <SettingsSection
          id="currency"
          title="Currency"
          description="Choose the money format used for detected prices."
          disabled={controlsDisabled}
        >
          {targetCurrencyControl}
          <div className="setting-row setting-row--status">
            <div className="setting-copy">
              <span className="setting-label">Exchange rates</span>
              <p>Rates load on demand and are cached temporarily.</p>
            </div>
            <RateStatus
              status={rateStatus}
              isRefreshing={isRefreshingRates}
              disabled={controlsDisabled}
              onRefresh={refreshRates}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          id="appearance"
          title="Appearance"
          description="Control how inline conversion badges are displayed."
          disabled={controlsDisabled}
        >
          <SelectSetting
            id="badge-style"
            label="Badge style"
            value={settings.badgeStyle}
            disabled={controlsDisabled}
            onChange={(event) =>
              updateSetting(
                "badgeStyle",
                event.currentTarget.value as UserSettings["badgeStyle"]
              )
            }
          >
            <option value="default">Default</option>
            <option value="compact">Compact</option>
            <option value="minimal">Minimal</option>
          </SelectSetting>
          <SelectSetting
            id="badge-visibility"
            label="Badge visibility"
            value={settings.badgeVisibility}
            disabled={controlsDisabled}
            onChange={(event) =>
              updateSetting(
                "badgeVisibility",
                event.currentTarget.value as UserSettings["badgeVisibility"]
              )
            }
          >
            <option value="always">Always show</option>
            <option value="hover">Show on hover</option>
          </SelectSetting>
        </SettingsSection>

        <SettingsSection
          id="units"
          title="Units"
          description="Set the measurement system and optional exact targets."
          disabled={controlsDisabled}
        >
          <SelectSetting
            id="unit-system"
            label="Measurement system"
            description="Auto chooses an appropriate opposite-system unit."
            value={settings.unitSystem}
            disabled={controlsDisabled}
            onChange={(event) =>
              updateSetting(
                "unitSystem",
                event.currentTarget.value as UserSettings["unitSystem"]
              )
            }
          >
            <option value="auto">Auto</option>
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </SelectSetting>

          <div className="advanced-settings">
            <div className="advanced-heading">
              <h3>Advanced target overrides</h3>
              <p>Exact targets take priority over the measurement system.</p>
            </div>
            <div className="compact-fields">
              <CompactSelect
                id="length-target"
                label="Length"
                value={settings.targetLengthUnit}
                disabled={controlsDisabled}
                onChange={(event) =>
                  updateSetting(
                    "targetLengthUnit",
                    event.currentTarget.value as UserSettings["targetLengthUnit"]
                  )
                }
              >
                <option value="auto">Auto</option>
                <option value="mm">Millimeters (mm)</option>
                <option value="cm">Centimeters (cm)</option>
                <option value="m">Meters (m)</option>
                <option value="km">Kilometers (km)</option>
                <option value="in">Inches (in)</option>
                <option value="ft">Feet (ft)</option>
                <option value="yd">Yards (yd)</option>
                <option value="mi">Miles (mi)</option>
              </CompactSelect>
              <CompactSelect
                id="weight-target"
                label="Weight"
                value={settings.targetWeightUnit}
                disabled={controlsDisabled}
                onChange={(event) =>
                  updateSetting(
                    "targetWeightUnit",
                    event.currentTarget.value as UserSettings["targetWeightUnit"]
                  )
                }
              >
                <option value="auto">Auto</option>
                <option value="mg">Milligrams (mg)</option>
                <option value="g">Grams (g)</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="oz">Ounces (oz)</option>
                <option value="lb">Pounds (lb)</option>
              </CompactSelect>
              <CompactSelect
                id="temperature-target"
                label="Temperature"
                value={settings.targetTemperatureUnit}
                disabled={controlsDisabled}
                onChange={(event) =>
                  updateSetting(
                    "targetTemperatureUnit",
                    event.currentTarget.value as UserSettings["targetTemperatureUnit"]
                  )
                }
              >
                <option value="auto">Auto</option>
                <option value="c">Celsius (deg C)</option>
                <option value="f">Fahrenheit (deg F)</option>
              </CompactSelect>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          id="sites"
          title="Sites"
          description="Choose where inline conversions may appear."
          disabled={controlsDisabled}
        >
          <div className="domain-fields">
            <DomainListField
              id="whitelist-domains"
              label="Whitelist domains"
              count={settings.whitelist.length}
              value={whitelistDraft}
              disabled={controlsDisabled}
              placeholder={"amazon.com\nebay.co.uk"}
              description="When populated, conversions run only on these domains."
              onChange={(value) => updateDomains("whitelist", value)}
            />
            <DomainListField
              id="blacklist-domains"
              label="Blacklist domains"
              count={settings.blacklist.length}
              value={blacklistDraft}
              disabled={controlsDisabled}
              placeholder="example.com"
              description="Conversions never run on these domains."
              onChange={(value) => updateDomains("blacklist", value)}
            />
          </div>
        </SettingsSection>
      </div>

      {error ? (
        <p className="save-status save-status--error" role="alert">
          {error}
        </p>
      ) : (
        <p className="save-status" role="status" aria-live="polite">
          {settingsApplyStatus}
        </p>
      )}
    </main>
  );
}
