import { useEffect, useMemo, useRef, useState } from "react";
import { fiatCurrencies } from "../data/currencies";
import { getSettings, saveSettings } from "../services/settings";
import type { UserSettings } from "../types/settings";

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

function App() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const sortedCurrencies = useMemo(
    () => [...fiatCurrencies].sort((left, right) => left.code.localeCompare(right.code)),
    []
  );

  useEffect(() => {
    let cancelled = false;

    void getSettings()
      .then((loadedSettings) => {
        if (!cancelled) {
          setSettings(loadedSettings);
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

  function persistSettings(nextSettings: UserSettings): void {
    setSettings(nextSettings);
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

      <section style={styles.card} aria-label="Conversion settings">
        <div style={styles.toggleRow}>
          <div style={styles.labelGroup}>
            <span style={styles.label}>Enabled</span>
            <p style={styles.description}>
              Show inline conversions on supported pages.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Enable currency conversions"
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
