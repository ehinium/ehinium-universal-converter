import { useEffect, useMemo, useRef, useState } from "react";
import { fiatCurrencies } from "../data/currencies";
import { isDomainAllowed } from "../services/domainRules";
import { getExchangeRates } from "../services/rates";
import {
  getManualConversion,
  type ManualConversionResult,
} from "../services/selectedTextConverter";
import { getSettings, saveSettings } from "../services/settings";
import {
  getActiveTabHostname,
  setSiteAllowed,
} from "../services/siteControls";
import type { UserSettings } from "../types/settings";
import {
  copyManualConversion,
  formatManualConversionInput,
} from "./manualConversion";

const MANUAL_CONVERSION_DEBOUNCE_MS = 250;
const COPY_FEEDBACK_DURATION_MS = 900;

const styles = {
  page: {
    width: "340px",
    minHeight: "280px",
    boxSizing: "border-box",
    padding: "22px",
    color: "#172033",
    background:
      "linear-gradient(145deg, rgb(248, 250, 255) 0%, rgb(239, 244, 255) 100%)",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    marginBottom: "20px",
  },
  eyebrow: {
    margin: "0 0 5px",
    color: "#586987",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    fontSize: "21px",
    lineHeight: 1.25,
    letterSpacing: "-0.025em",
  },
  card: {
    display: "grid",
    gap: "18px",
    padding: "18px",
    border: "1px solid rgba(104, 125, 164, 0.18)",
    borderRadius: "14px",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    boxShadow: "0 10px 30px rgba(52, 72, 110, 0.09)",
  },
  domainSection: {
    display: "grid",
    gap: "8px",
  },
  domainHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "12px",
  },
  count: {
    color: "#6b7890",
    fontSize: "11px",
    fontWeight: 700,
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
  },
  labelGroup: {
    display: "grid",
    gap: "3px",
  },
  label: {
    color: "#25324a",
    fontSize: "13px",
    fontWeight: 700,
  },
  description: {
    margin: 0,
    color: "#6b7890",
    fontSize: "12px",
    lineHeight: 1.45,
  },
  switch: {
    position: "relative",
    display: "inline-flex",
    flexShrink: 0,
    width: "42px",
    height: "24px",
    padding: 0,
    border: 0,
    borderRadius: "999px",
    cursor: "pointer",
    transition: "background-color 160ms ease",
  },
  switchKnob: {
    position: "absolute",
    top: "3px",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    backgroundColor: "#ffffff",
    boxShadow: "0 2px 5px rgba(30, 42, 70, 0.28)",
    transition: "transform 160ms ease",
  },
  field: {
    display: "grid",
    gap: "7px",
  },
  select: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 34px 10px 11px",
    border: "1px solid #cdd6e6",
    borderRadius: "9px",
    outline: "none",
    color: "#25324a",
    backgroundColor: "#ffffff",
    font: "inherit",
    fontSize: "13px",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 11px",
    border: "1px solid #cdd6e6",
    borderRadius: "9px",
    outline: "none",
    color: "#25324a",
    backgroundColor: "#ffffff",
    font: "inherit",
    fontSize: "13px",
  },
  manualResult: {
    display: "grid",
    gap: "5px",
    padding: "12px",
    borderRadius: "10px",
    backgroundColor: "rgba(73, 108, 242, 0.08)",
  },
  manualSource: {
    color: "#6b7890",
    fontSize: "12px",
  },
  manualConverted: {
    color: "#172033",
    fontSize: "20px",
    fontWeight: 750,
  },
  copyButton: {
    justifySelf: "start",
    marginTop: "4px",
    padding: "6px 10px",
    border: "1px solid rgba(73, 108, 242, 0.32)",
    borderRadius: "7px",
    color: "#3452c6",
    backgroundColor: "#ffffff",
    font: "inherit",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  textarea: {
    width: "100%",
    minHeight: "82px",
    boxSizing: "border-box",
    padding: "10px 11px",
    resize: "vertical",
    border: "1px solid #cdd6e6",
    borderRadius: "9px",
    outline: "none",
    color: "#25324a",
    backgroundColor: "#ffffff",
    font: '12px/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
  },
  status: {
    minHeight: "18px",
    margin: "12px 2px 0",
    color: "#6b7890",
    fontSize: "11px",
  },
  error: {
    margin: "12px 2px 0",
    color: "#b42318",
    fontSize: "12px",
    lineHeight: 1.4,
  },
  loading: {
    display: "grid",
    placeItems: "center",
    minHeight: "170px",
    color: "#586987",
    fontSize: "13px",
  },
} satisfies Record<string, React.CSSProperties>;

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

function App() {
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
  const settingsRef = useRef<UserSettings | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const sortedCurrencies = useMemo(
    () => [...fiatCurrencies].sort((left, right) => left.code.localeCompare(right.code)),
    []
  );

  useEffect(() => {
    let cancelled = false;

    void Promise.all([getSettings(), getActiveTabHostname()])
      .then(([loadedSettings, hostname]) => {
        if (!cancelled) {
          settingsRef.current = loadedSettings;
          setSettings(loadedSettings);
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
  }, []);

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
          return (await getExchangeRates(baseCurrency)).rates;
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
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setManualResult(null);
    setCopyLabel("Copy");
    setIsManualConverting(Boolean(manualInput.trim()) && nextSettings.enabled);
    setError(null);
    setIsSaving(true);

    const saveOperation = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveSettings(nextSettings));

    saveQueueRef.current = saveOperation;

    void saveOperation
      .then(() => {
        setError(null);
      })
      .catch((saveError: unknown) => {
        setError(getErrorMessage(saveError));
      })
      .finally(() => {
        if (saveQueueRef.current === saveOperation) {
          setIsSaving(false);
        }
      });
  }

  function updateDomains(
    key: "whitelist" | "blacklist",
    value: string
  ): void {
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

    const nextSettings = setSiteAllowed(
      currentSettings,
      currentHostname,
      allowed
    );

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

  if (isLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.loading} role="status">
          Loading settings...
        </div>
      </main>
    );
  }

  if (!settings) {
    return (
      <main style={styles.page}>
        <header style={styles.header}>
          <h1 style={styles.title}>Ehinium Universal Converter</h1>
        </header>
        <p style={styles.error} role="alert">
          {error ?? "Unable to load settings."}
        </p>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <p style={styles.eyebrow}>Settings</p>
        <h1 style={styles.title}>Ehinium Universal Converter</h1>
      </header>

      <section style={styles.card} aria-label="Manual conversion">
        <span style={styles.label}>Manual conversion</span>

        <input
          ref={manualInputRef}
          type="text"
          value={manualInput}
          onChange={(event) => updateManualInput(event.target.value)}
          onBlur={(event) => formatManualInput(event.currentTarget.value)}
          onPaste={formatPastedManualInput}
          placeholder="Enter value, e.g. 100 EUR or 180 cm"
          aria-label="Manual conversion value"
          style={styles.input}
        />

        {!settings.enabled ? (
          <span style={styles.description}>Conversions are disabled</span>
        ) : manualResult ? (
          <div style={styles.manualResult} aria-live="polite">
            <span style={styles.manualSource}>{manualResult.source}</span>
            <span style={styles.manualConverted}>{manualResult.converted}</span>
            <button
              type="button"
              onClick={copyManualResult}
              style={styles.copyButton}
            >
              {copyLabel}
            </button>
          </div>
        ) : manualInput.trim() && !isManualConverting ? (
          <span style={styles.description}>No convertible value found</span>
        ) : isManualConverting ? (
          <span style={styles.description}>Converting...</span>
        ) : null}
      </section>

      <section
        style={{ ...styles.card, marginTop: "14px" }}
        aria-label="Conversion settings"
      >
        <div style={styles.toggleRow}>
          <div style={styles.labelGroup}>
            <span style={styles.label}>Enable conversions</span>
            <p style={styles.description}>
              Show inline conversions on supported pages.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Enable conversions"
            onClick={() =>
              persistSettings({ ...settings, enabled: !settings.enabled })
            }
            style={{
              ...styles.switch,
              backgroundColor: settings.enabled ? "#496cf2" : "#b7c0cf",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                ...styles.switchKnob,
                transform: settings.enabled
                  ? "translateX(21px)"
                  : "translateX(3px)",
              }}
            />
          </button>
        </div>

        <label style={styles.field}>
          <span style={styles.label}>Conversion mode</span>
          <select
            value={settings.converterMode}
            onChange={(event) =>
              persistSettings({
                ...settings,
                converterMode: event.target.value as UserSettings["converterMode"],
              })
            }
            style={styles.select}
          >
            <option value="currencies">Currencies only</option>
            <option value="units">Units only</option>
            <option value="everything">Everything</option>
          </select>
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Target currency</span>
          <select
            value={settings.targetCurrency}
            onChange={(event) =>
              persistSettings({
                ...settings,
                targetCurrency: event.target.value,
              })
            }
            style={styles.select}
          >
            {sortedCurrencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} - {currency.name}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Badge style</span>
          <select
            value={settings.badgeStyle}
            onChange={(event) =>
              persistSettings({
                ...settings,
                badgeStyle: event.target.value as UserSettings["badgeStyle"],
              })
            }
            style={styles.select}
          >
            <option value="default">Default</option>
            <option value="compact">Compact</option>
            <option value="minimal">Minimal</option>
          </select>
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Badge visibility</span>
          <select
            value={settings.badgeVisibility}
            onChange={(event) =>
              persistSettings({
                ...settings,
                badgeVisibility:
                  event.target.value as UserSettings["badgeVisibility"],
              })
            }
            style={styles.select}
          >
            <option value="always">Always show</option>
            <option value="hover">Show on hover</option>
          </select>
        </label>
      </section>

      <section
        style={{ ...styles.card, marginTop: "14px" }}
        aria-label="Unit preferences"
      >
        <span style={styles.label}>Unit preferences</span>
        <p style={styles.description}>
          Auto keeps smart defaults. Metric/Imperial only converts values from
          the opposite system. Exact targets override this.
        </p>

        <label style={styles.field}>
          <span style={styles.label}>Unit system</span>
          <select
            value={settings.unitSystem}
            onChange={(event) =>
              persistSettings({
                ...settings,
                unitSystem: event.target.value as UserSettings["unitSystem"],
              })
            }
            style={styles.select}
          >
            <option value="auto">Auto</option>
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </select>
        </label>

        <span style={styles.label}>Advanced target overrides</span>

        <label style={styles.field}>
          <span style={styles.label}>Length target</span>
          <select
            value={settings.targetLengthUnit}
            onChange={(event) =>
              persistSettings({
                ...settings,
                targetLengthUnit:
                  event.target.value as UserSettings["targetLengthUnit"],
              })
            }
            style={styles.select}
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
          </select>
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Weight target</span>
          <select
            value={settings.targetWeightUnit}
            onChange={(event) =>
              persistSettings({
                ...settings,
                targetWeightUnit:
                  event.target.value as UserSettings["targetWeightUnit"],
              })
            }
            style={styles.select}
          >
            <option value="auto">Auto</option>
            <option value="mg">Milligrams (mg)</option>
            <option value="g">Grams (g)</option>
            <option value="kg">Kilograms (kg)</option>
            <option value="oz">Ounces (oz)</option>
            <option value="lb">Pounds (lb)</option>
          </select>
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Temperature target</span>
          <select
            value={settings.targetTemperatureUnit}
            onChange={(event) =>
              persistSettings({
                ...settings,
                targetTemperatureUnit:
                  event.target.value as UserSettings["targetTemperatureUnit"],
              })
            }
            style={styles.select}
          >
            <option value="auto">Auto</option>
            <option value="c">Celsius (°C)</option>
            <option value="f">Fahrenheit (°F)</option>
          </select>
        </label>
      </section>

      <section
        style={{ ...styles.card, marginTop: "14px" }}
        aria-label="Site settings"
      >
        <span style={styles.label}>Site settings</span>

        {currentHostname ? (
          <div style={styles.toggleRow}>
            <div style={styles.labelGroup}>
              <span style={styles.label}>Enable on this site</span>
              <p style={styles.description}>{currentHostname}</p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={isDomainAllowed(currentHostname, settings)}
              aria-label="Enable on this site"
              onClick={() =>
                updateCurrentSite(!isDomainAllowed(currentHostname, settings))
              }
              style={{
                ...styles.switch,
                backgroundColor: isDomainAllowed(currentHostname, settings)
                  ? "#496cf2"
                  : "#b7c0cf",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  ...styles.switchKnob,
                  transform: isDomainAllowed(currentHostname, settings)
                    ? "translateX(21px)"
                    : "translateX(3px)",
                }}
              />
            </button>
          </div>
        ) : (
          <span style={styles.description}>
            Site controls unavailable on this page
          </span>
        )}
      </section>

      <section
        style={{ ...styles.card, marginTop: "14px" }}
        aria-label="Domain settings"
      >
        <label style={styles.domainSection}>
          <span style={styles.domainHeader}>
            <span style={styles.label}>
              Whitelist Domains ({settings.whitelist.length})
            </span>
            <span style={styles.count}>One per line</span>
          </span>
          <textarea
            value={whitelistDraft}
            onChange={(event) => updateDomains("whitelist", event.target.value)}
            placeholder={"amazon.com\nebay.co.uk\nbanggood.com"}
            spellCheck={false}
            style={styles.textarea}
          />
          <span style={styles.description}>
            When populated, conversions run only on these domains.
          </span>
        </label>

        <label style={styles.domainSection}>
          <span style={styles.domainHeader}>
            <span style={styles.label}>
              Blacklist Domains ({settings.blacklist.length})
            </span>
            <span style={styles.count}>One per line</span>
          </span>
          <textarea
            value={blacklistDraft}
            onChange={(event) => updateDomains("blacklist", event.target.value)}
            placeholder={"example.com"}
            spellCheck={false}
            style={styles.textarea}
          />
          <span style={styles.description}>
            Conversions never run on these domains.
          </span>
        </label>
      </section>

      {error ? (
        <p style={styles.error} role="alert">
          {error}
        </p>
      ) : (
        <p style={styles.status} role="status">
          {isSaving ? "Saving settings..." : "Settings saved automatically."}
        </p>
      )}
    </main>
  );
}

export default App;
