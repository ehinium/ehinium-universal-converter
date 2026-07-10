import {
  type ChangeEventHandler,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fiatCurrencies } from "../data/currencies";
import { isDomainAllowed } from "../services/domainRules";
import {
  getExchangeRates,
  getExchangeRateStatus,
  refreshExchangeRates,
  type ExchangeRateStatus,
} from "../services/rates";
import {
  getManualConversion,
  type ManualConversionResult,
} from "../services/selectedTextConverter";
import { getSettings, saveSettings } from "../services/settings";
import {
  formatSettingsApplyStatus,
  notifyActiveTabSettingsChanged,
} from "../services/settingsApply";
import {
  getActiveTabHostname,
  setSiteAllowed,
} from "../services/siteControls";
import type { UserSettings } from "../types/settings";
import { parseCurrencies } from "../utils/currencyParser";
import { parseUnits } from "../utils/unitParser";
import {
  copyManualConversion,
  formatManualConversionInput,
} from "../popup/manualConversion";
import { formatRateStatus, refreshRateStatus } from "../popup/rateStatus";

const MANUAL_CONVERSION_DEBOUNCE_MS = 250;
const COPY_FEEDBACK_DURATION_MS = 900;

type SettingsSectionProps = {
  id: string;
  title: string;
  description?: string;
  disabled?: boolean;
  children: ReactNode;
};

type SelectSettingProps = {
  id: string;
  label: string;
  description?: string;
  value: string;
  disabled?: boolean;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
};

type ToggleSettingProps = {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

type CompactSelectProps = Omit<SelectSettingProps, "description">;

type RateStatusProps = {
  status: ExchangeRateStatus;
  isRefreshing: boolean;
  disabled: boolean;
  onRefresh: () => void;
};

type ManualConverterProps = {
  value: string;
  result: ManualConversionResult | null;
  feedback: ManualFeedback;
  isConverting: boolean;
  disabled: boolean;
  copyLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
  onPaste: () => void;
  onCopy: () => void;
};

type ManualFeedback = {
  message: string;
  tone: "neutral" | "error";
  invalid: boolean;
};

export type SettingsSurface = "popup" | "options";

type SettingsAppProps = {
  surface: SettingsSurface;
};

function SettingsSection({
  id,
  title,
  description,
  disabled = false,
  children,
}: SettingsSectionProps) {
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <section
      className={`settings-section${disabled ? " settings-section--disabled" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-disabled={disabled || undefined}
    >
      <div className="section-heading">
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}
      </div>
      <div className="section-content">{children}</div>
    </section>
  );
}

function SelectSetting({
  id,
  label,
  description,
  value,
  disabled = false,
  onChange,
  children,
}: SelectSettingProps) {
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={`setting-row${disabled ? " setting-row--disabled" : ""}`}>
      <div className="setting-copy">
        <label className="setting-label" htmlFor={id}>
          {label}
        </label>
        {description ? <p id={descriptionId}>{description}</p> : null}
      </div>
      <div className="setting-control">
        <select
          id={id}
          className="select-control"
          value={value}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={onChange}
        >
          {children}
        </select>
      </div>
    </div>
  );
}

function CompactSelect({
  id,
  label,
  value,
  disabled = false,
  onChange,
  children,
}: CompactSelectProps) {
  return (
    <label className="compact-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        className="select-control"
        value={value}
        disabled={disabled}
        onChange={onChange}
      >
        {children}
      </select>
    </label>
  );
}

function ToggleSetting({
  id,
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: ToggleSettingProps) {
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <label className={`toggle-setting${disabled ? " toggle-setting--disabled" : ""}`}>
      <span className="setting-copy">
        <span className="setting-label" id={labelId}>
          {label}
        </span>
        <span className="setting-description" id={descriptionId}>
          {description}
        </span>
      </span>
      <span className="toggle-slot">
        <input
          id={id}
          className="toggle-input"
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="toggle-control" aria-hidden="true">
          <span className="toggle-knob" />
        </span>
      </span>
    </label>
  );
}

function RateStatus({
  status,
  isRefreshing,
  disabled,
  onRefresh,
}: RateStatusProps) {
  const [message, ...details] = formatRateStatus(status);
  const hasError = status.lastErrorAt !== null;

  return (
    <div
      className={`rate-status${hasError ? " rate-status--error" : ""}`}
      aria-live="polite"
    >
      <span className="status-indicator" aria-hidden="true" />
      <span className="rate-status-copy">
        <span className="rate-status-message">{message}</span>
        {details.length > 0 ? (
          <span className="rate-status-detail">{details.join(" · ")}</span>
        ) : null}
      </span>
      <button
        className="button button--secondary"
        type="button"
        disabled={disabled || isRefreshing}
        aria-busy={isRefreshing}
        onClick={onRefresh}
      >
        {isRefreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

function ManualConverter({
  value,
  result,
  feedback,
  isConverting,
  disabled,
  copyLabel,
  inputRef,
  onChange,
  onBlur,
  onPaste,
  onCopy,
}: ManualConverterProps) {
  const isInvalid = !disabled && !isConverting && !result && feedback.invalid;

  let state: ReactNode;

  if (disabled) {
    state = <p className="manual-state">Enable conversions to use this tool.</p>;
  } else if (result) {
    state = (
      <div className="manual-result">
        <span className="manual-result-copy">
          <span className="manual-source">{result.source}</span>
          <output className="manual-converted" htmlFor="manual-conversion-input">
            {result.converted}
          </output>
        </span>
        <button className="button button--secondary" type="button" onClick={onCopy}>
          {copyLabel}
        </button>
      </div>
    );
  } else if (isConverting) {
    state = <p className="manual-state">Converting…</p>;
  } else {
    state = (
      <p
        className={`manual-state${
          feedback.tone === "error" ? " manual-state--error" : ""
        }`}
      >
        {feedback.message}
      </p>
    );
  }

  return (
    <div className="manual-converter">
      <label className="input-label" htmlFor="manual-conversion-input">
        Value to convert
      </label>
      <input
        ref={inputRef}
        id="manual-conversion-input"
        className="text-control"
        type="text"
        value={value}
        disabled={disabled}
        aria-invalid={isInvalid}
        aria-describedby="manual-conversion-state"
        placeholder="Enter 100 EUR or 180 cm"
        autoComplete="off"
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={(event) => onBlur(event.currentTarget.value)}
        onPaste={onPaste}
      />
      <div id="manual-conversion-state" className="manual-state-region" aria-live="polite">
        {state}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function normalizeDomains(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
}

function domainsAreEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((domain, index) => domain === right[index])
  );
}

function looksLikeIncompleteManualInput(value: string): boolean {
  return (
    /^[+-]?[\d\s.,]+$/u.test(value) ||
    /^\p{L}{1,5}$/u.test(value) ||
    /^[+-]?[\d\s.,]+\s*°?\p{L}{1,2}$/u.test(value)
  );
}

function getManualFeedback(
  value: string,
  settings: UserSettings,
  status: ExchangeRateStatus
): ManualFeedback {
  const input = value.trim();

  if (!input) {
    return {
      message: "Enter a value to see its conversion.",
      tone: "neutral",
      invalid: false,
    };
  }

  const currencyMatch = parseCurrencies(input)[0];
  const unitMatch = parseUnits(input)[0];

  if (currencyMatch) {
    if (settings.converterMode === "units") {
      return {
        message: "Currency conversion is off in the selected conversion mode.",
        tone: "neutral",
        invalid: false,
      };
    }

    if (currencyMatch.currency === settings.targetCurrency) {
      return {
        message: `This value is already in ${settings.targetCurrency}.`,
        tone: "neutral",
        invalid: false,
      };
    }

    if (status.lastErrorAt !== null) {
      return {
        message: "Currency conversion is temporarily unavailable because rates could not be loaded.",
        tone: "error",
        invalid: false,
      };
    }

    return {
      message: "No conversion is available for this currency with the current rates.",
      tone: "neutral",
      invalid: false,
    };
  }

  if (unitMatch) {
    return {
      message:
        settings.converterMode === "currencies"
          ? "Unit conversion is off in the selected conversion mode."
          : "No conversion is needed with the current unit settings.",
      tone: "neutral",
      invalid: false,
    };
  }

  if (looksLikeIncompleteManualInput(input)) {
    return {
      message: "Add a supported currency or measurement unit to complete the value.",
      tone: "neutral",
      invalid: false,
    };
  }

  return {
    message: "Unsupported value. Try a currency or measurement with its unit.",
    tone: "error",
    invalid: true,
  };
}

export function SettingsApp({ surface }: SettingsAppProps) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [whitelistDraft, setWhitelistDraft] = useState("");
  const [blacklistDraft, setBlacklistDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentHostname, setCurrentHostname] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [manualResult, setManualResult] =
    useState<ManualConversionResult | null>(null);
  const [isManualConverting, setIsManualConverting] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [rateStatus, setRateStatus] = useState<ExchangeRateStatus>({
    response: null,
    fetchedAt: null,
    lastErrorAt: null,
  });
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [showReloadNotice, setShowReloadNotice] = useState(false);
  const settingsRef = useRef<UserSettings | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  const rateRefreshIdRef = useRef(0);

  const sortedCurrencies = useMemo(
    () =>
      [...fiatCurrencies].sort((left, right) =>
        left.code.localeCompare(right.code)
      ),
    []
  );

  useEffect(() => {
    let cancelled = false;

    const hostnameRequest =
      surface === "popup" ? getActiveTabHostname() : Promise.resolve(null);

    void Promise.all([getSettings(), hostnameRequest])
      .then(([loadedSettings, hostname]) => {
        if (!cancelled) {
          settingsRef.current = loadedSettings;
          setSettings(loadedSettings);
          setRateStatus(getExchangeRateStatus(loadedSettings.targetCurrency));
          setCurrentHostname(hostname);
          setWhitelistDraft(loadedSettings.whitelist.join("\n"));
          setBlacklistDraft(loadedSettings.blacklist.join("\n"));
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [surface]);

  useEffect(() => {
    let cancelled = false;
    const value = manualInput.trim();

    if (!settings || !value || !settings.enabled) {
      return;
    }

    const timer = setTimeout(() => {
      setIsManualConverting(true);
      void getManualConversion(value, settings, {
        async getRates(baseCurrency) {
          try {
            return (await getExchangeRates(baseCurrency)).rates;
          } finally {
            if (!cancelled) {
              setRateStatus(getExchangeRateStatus(baseCurrency));
            }
          }
        },
      })
        .then((result) => {
          if (!cancelled) {
            setManualResult(result);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setManualResult(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsManualConverting(false);
          }
        });
    }, MANUAL_CONVERSION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [manualInput, settings]);

  function persistSettings(nextSettings: UserSettings): void {
    const saveVersion = saveVersionRef.current + 1;
    saveVersionRef.current = saveVersion;
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setManualResult(null);
    setCopyLabel("Copy");
    setIsManualConverting(Boolean(manualInput.trim()) && nextSettings.enabled);
    setError(null);
    setIsSaving(true);

    const saveOperation = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveSettings(nextSettings);
        const applied =
          surface === "popup" ? await notifyActiveTabSettingsChanged() : true;

        if (saveVersionRef.current === saveVersion) {
          setError(null);
          setShowReloadNotice(!applied);
        }
      });

    saveQueueRef.current = saveOperation;

    void saveOperation
      .catch((saveError: unknown) => {
        if (saveVersionRef.current === saveVersion) {
          setError(getErrorMessage(saveError));
        }
      })
      .finally(() => {
        if (saveVersionRef.current === saveVersion) {
          setIsSaving(false);
        }
      });
  }

  function updateTargetCurrency(targetCurrency: string): void {
    if (!settings) {
      return;
    }

    rateRefreshIdRef.current += 1;
    setIsRefreshingRates(false);
    setRateStatus(getExchangeRateStatus(targetCurrency));
    persistSettings({ ...settings, targetCurrency });
  }

  function updateDomains(key: "whitelist" | "blacklist", value: string): void {
    if (key === "whitelist") {
      setWhitelistDraft(value);
    } else {
      setBlacklistDraft(value);
    }

    const currentSettings = settingsRef.current;

    if (!currentSettings) {
      return;
    }

    const domains = normalizeDomains(value);

    if (!domainsAreEqual(currentSettings[key], domains)) {
      persistSettings({ ...currentSettings, [key]: domains });
    }
  }

  function updateCurrentSite(allowed: boolean): void {
    const currentSettings = settingsRef.current;

    if (!currentSettings || !currentHostname) {
      return;
    }

    const nextSettings = setSiteAllowed(currentSettings, currentHostname, allowed);

    setWhitelistDraft(nextSettings.whitelist.join("\n"));
    setBlacklistDraft(nextSettings.blacklist.join("\n"));
    persistSettings(nextSettings);
  }

  function copyManualResult(): void {
    if (!manualResult) {
      return;
    }

    void copyManualConversion(manualResult.converted).then((copied) => {
      if (!copied) {
        return;
      }

      setCopyLabel("Copied");
      setTimeout(() => {
        setCopyLabel("Copy");
      }, COPY_FEEDBACK_DURATION_MS);
    });
  }

  function updateManualInput(value: string): void {
    setManualInput(value);
    setManualResult(null);
    setCopyLabel("Copy");
    setIsManualConverting(Boolean(value.trim()) && Boolean(settings?.enabled));
  }

  function formatManualInput(value: string): void {
    const formatted = formatManualConversionInput(value);

    if (formatted !== value) {
      updateManualInput(formatted);
    }
  }

  function formatPastedManualInput(): void {
    setTimeout(() => {
      const value = manualInputRef.current?.value;

      if (value !== undefined) {
        formatManualInput(value);
      }
    }, 0);
  }

  function refreshRates(): void {
    const baseCurrency = settingsRef.current?.targetCurrency;

    if (!baseCurrency) {
      return;
    }

    const refreshId = rateRefreshIdRef.current + 1;
    rateRefreshIdRef.current = refreshId;
    setIsRefreshingRates(true);

    void refreshRateStatus(baseCurrency, refreshExchangeRates)
      .catch(() => undefined)
      .finally(() => {
        if (rateRefreshIdRef.current !== refreshId) {
          return;
        }

        if (settingsRef.current?.targetCurrency === baseCurrency) {
          setRateStatus(getExchangeRateStatus(baseCurrency));
        }

        setIsRefreshingRates(false);
      });
  }

  function openOptionsPage(): void {
    void chrome.runtime.openOptionsPage().catch((openError: unknown) => {
      setError(getErrorMessage(openError));
    });
  }

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

  if (!settings) {
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

  const controlsDisabled = !settings.enabled || isSaving;
  const activeSiteIsAllowed = currentHostname
    ? isDomainAllowed(currentHostname, settings)
    : false;
  const activeManualFeedback = getManualFeedback(manualInput, settings, rateStatus);
  const settingsApplyStatus = formatSettingsApplyStatus(isSaving, showReloadNotice);
  const showPopupStatus = Boolean(error) || isSaving || showReloadNotice;

  const targetCurrencyControl = (
    <SelectSetting
      id="target-currency"
      label="Target currency"
      value={settings.targetCurrency}
      disabled={controlsDisabled}
      onChange={(event) => updateTargetCurrency(event.currentTarget.value)}
    >
      {sortedCurrencies.map((currency) => (
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
        persistSettings({
          ...settings,
          converterMode: event.currentTarget.value as UserSettings["converterMode"],
        })
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
      feedback={activeManualFeedback}
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
              onChange={(enabled) => persistSettings({ ...settings, enabled })}
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
                checked={activeSiteIsAllowed}
                disabled={controlsDisabled}
                onChange={updateCurrentSite}
              />
            ) : (
              <p className="site-unavailable">Site controls are unavailable on this page.</p>
            )}
          </div>

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
            onChange={(enabled) => persistSettings({ ...settings, enabled })}
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
              persistSettings({
                ...settings,
                badgeStyle: event.currentTarget.value as UserSettings["badgeStyle"],
              })
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
              persistSettings({
                ...settings,
                badgeVisibility: event.currentTarget
                  .value as UserSettings["badgeVisibility"],
              })
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
              persistSettings({
                ...settings,
                unitSystem: event.currentTarget.value as UserSettings["unitSystem"],
              })
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
                  persistSettings({
                    ...settings,
                    targetLengthUnit: event.currentTarget
                      .value as UserSettings["targetLengthUnit"],
                  })
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
                  persistSettings({
                    ...settings,
                    targetWeightUnit: event.currentTarget
                      .value as UserSettings["targetWeightUnit"],
                  })
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
                  persistSettings({
                    ...settings,
                    targetTemperatureUnit: event.currentTarget
                      .value as UserSettings["targetTemperatureUnit"],
                  })
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
            <label className="domain-field" htmlFor="whitelist-domains">
              <span className="domain-label-row">
                <span className="setting-label">Whitelist domains</span>
                <span>{settings.whitelist.length} - one per line</span>
              </span>
              <textarea
                id="whitelist-domains"
                className="textarea-control"
                value={whitelistDraft}
                disabled={controlsDisabled}
                rows={3}
                spellCheck={false}
                placeholder={"amazon.com\nebay.co.uk"}
                aria-describedby="whitelist-description"
                onChange={(event) =>
                  updateDomains("whitelist", event.currentTarget.value)
                }
              />
              <span id="whitelist-description" className="field-help">
                When populated, conversions run only on these domains.
              </span>
            </label>

            <label className="domain-field" htmlFor="blacklist-domains">
              <span className="domain-label-row">
                <span className="setting-label">Blacklist domains</span>
                <span>{settings.blacklist.length} - one per line</span>
              </span>
              <textarea
                id="blacklist-domains"
                className="textarea-control"
                value={blacklistDraft}
                disabled={controlsDisabled}
                rows={3}
                spellCheck={false}
                placeholder="example.com"
                aria-describedby="blacklist-description"
                onChange={(event) =>
                  updateDomains("blacklist", event.currentTarget.value)
                }
              />
              <span id="blacklist-description" className="field-help">
                Conversions never run on these domains.
              </span>
            </label>
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

/*
  if (isLoading) {
    return (
      <main className="settings-page">
        <header className="settings-header">
          <p className="eyebrow">Settings</p>
          <h1>Ehinium Universal Converter</h1>
        </header>
        <div className="loading-panel" role="status">
          Loading settings…
        </div>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="settings-page">
        <header className="settings-header">
          <p className="eyebrow">Settings</p>
          <h1>Ehinium Universal Converter</h1>
        </header>
        <div className="loading-panel loading-panel--error" role="alert">
          {error ?? "Unable to load settings."}
        </div>
      </main>
    );
  }

  const dependentSettingsDisabled = !settings.enabled;
  const currentSiteIsAllowed = currentHostname
    ? isDomainAllowed(currentHostname, settings)
    : false;
  const manualFeedback = getManualFeedback(manualInput, settings, rateStatus);

  return (
    <main className="settings-page">
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Ehinium Universal Converter</h1>
        <p className="header-subtitle">
          Configure automatic and manual conversions.
        </p>
      </header>

      <div className="settings-surface">
        <SettingsSection id="general" title="General">
          <ToggleSetting
            id="conversions-enabled"
            label="Enable conversions"
            description="Show inline conversions on supported pages."
            checked={settings.enabled}
            onChange={(enabled) => persistSettings({ ...settings, enabled })}
          />
          <SelectSetting
            id="conversion-mode"
            label="Conversion mode"
            description="Choose which values the extension detects."
            value={settings.converterMode}
            disabled={dependentSettingsDisabled}
            onChange={(event) =>
              persistSettings({
                ...settings,
                converterMode: event.currentTarget
                  .value as UserSettings["converterMode"],
              })
            }
          >
            <option value="currencies">Currencies only</option>
            <option value="units">Units only</option>
            <option value="everything">Everything</option>
          </SelectSetting>
        </SettingsSection>

        <SettingsSection
          id="currency"
          title="Currency"
          description="Choose the currency used for converted prices."
          disabled={dependentSettingsDisabled}
        >
          <SelectSetting
            id="target-currency"
            label="Target currency"
            value={settings.targetCurrency}
            disabled={dependentSettingsDisabled}
            onChange={(event) => updateTargetCurrency(event.currentTarget.value)}
          >
            {sortedCurrencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </SelectSetting>
          <div className="setting-row setting-row--status">
            <div className="setting-copy">
              <span className="setting-label">Exchange rates</span>
              <p>Rates load on demand and are cached temporarily.</p>
            </div>
            <RateStatus
              status={rateStatus}
              isRefreshing={isRefreshingRates}
              disabled={dependentSettingsDisabled}
              onRefresh={refreshRates}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          id="appearance"
          title="Appearance"
          description="Control how inline conversion badges are displayed."
          disabled={dependentSettingsDisabled}
        >
          <SelectSetting
            id="badge-style"
            label="Badge style"
            value={settings.badgeStyle}
            disabled={dependentSettingsDisabled}
            onChange={(event) =>
              persistSettings({
                ...settings,
                badgeStyle: event.currentTarget.value as UserSettings["badgeStyle"],
              })
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
            disabled={dependentSettingsDisabled}
            onChange={(event) =>
              persistSettings({
                ...settings,
                badgeVisibility: event.currentTarget
                  .value as UserSettings["badgeVisibility"],
              })
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
          disabled={dependentSettingsDisabled}
        >
          <SelectSetting
            id="unit-system"
            label="Measurement system"
            description="Auto chooses an appropriate opposite-system unit."
            value={settings.unitSystem}
            disabled={dependentSettingsDisabled}
            onChange={(event) =>
              persistSettings({
                ...settings,
                unitSystem: event.currentTarget.value as UserSettings["unitSystem"],
              })
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
                disabled={dependentSettingsDisabled}
                onChange={(event) =>
                  persistSettings({
                    ...settings,
                    targetLengthUnit: event.currentTarget
                      .value as UserSettings["targetLengthUnit"],
                  })
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
                disabled={dependentSettingsDisabled}
                onChange={(event) =>
                  persistSettings({
                    ...settings,
                    targetWeightUnit: event.currentTarget
                      .value as UserSettings["targetWeightUnit"],
                  })
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
                disabled={dependentSettingsDisabled}
                onChange={(event) =>
                  persistSettings({
                    ...settings,
                    targetTemperatureUnit: event.currentTarget
                      .value as UserSettings["targetTemperatureUnit"],
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="c">Celsius (°C)</option>
                <option value="f">Fahrenheit (°F)</option>
              </CompactSelect>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          id="manual-conversion"
          title="Manual conversion"
          description="Convert a supported price or measurement without leaving this page."
          disabled={dependentSettingsDisabled}
        >
          <ManualConverter
            value={manualInput}
            result={manualResult}
            feedback={manualFeedback}
            isConverting={isManualConverting}
            disabled={dependentSettingsDisabled}
            copyLabel={copyLabel}
            inputRef={manualInputRef}
            onChange={updateManualInput}
            onBlur={formatManualInput}
            onPaste={formatPastedManualInput}
            onCopy={copyManualResult}
          />
        </SettingsSection>

        <SettingsSection
          id="sites"
          title="Sites"
          description="Choose where inline conversions may appear."
          disabled={dependentSettingsDisabled}
        >
          {currentHostname ? (
            <ToggleSetting
              id="current-site-enabled"
              label="Enable on this site"
              description={currentHostname}
              checked={currentSiteIsAllowed}
              disabled={dependentSettingsDisabled}
              onChange={updateCurrentSite}
            />
          ) : (
            <p className="site-unavailable">Site controls are unavailable on this page.</p>
          )}

          <div className="domain-fields">
            <label className="domain-field" htmlFor="whitelist-domains">
              <span className="domain-label-row">
                <span className="setting-label">Whitelist domains</span>
                <span>{settings.whitelist.length} · one per line</span>
              </span>
              <textarea
                id="whitelist-domains"
                className="textarea-control"
                value={whitelistDraft}
                disabled={dependentSettingsDisabled}
                rows={3}
                spellCheck={false}
                placeholder={"amazon.com\nebay.co.uk"}
                aria-describedby="whitelist-description"
                onChange={(event) =>
                  updateDomains("whitelist", event.currentTarget.value)
                }
              />
              <span id="whitelist-description" className="field-help">
                When populated, conversions run only on these domains.
              </span>
            </label>

            <label className="domain-field" htmlFor="blacklist-domains">
              <span className="domain-label-row">
                <span className="setting-label">Blacklist domains</span>
                <span>{settings.blacklist.length} · one per line</span>
              </span>
              <textarea
                id="blacklist-domains"
                className="textarea-control"
                value={blacklistDraft}
                disabled={dependentSettingsDisabled}
                rows={3}
                spellCheck={false}
                placeholder="example.com"
                aria-describedby="blacklist-description"
                onChange={(event) =>
                  updateDomains("blacklist", event.currentTarget.value)
                }
              />
              <span id="blacklist-description" className="field-help">
                Conversions never run on these domains.
              </span>
            </label>
          </div>
        </SettingsSection>
      </div>

      {error ? (
        <p className="save-status save-status--error" role="alert">
          {error}
        </p>
      ) : (
        <p className="save-status" role="status" aria-live="polite">
          {formatSettingsApplyStatus(isSaving, showReloadNotice)}
        </p>
      )}
    </main>
  );
}
*/
