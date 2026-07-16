import { useEffect, useRef, useState } from "react";
import { fiatCurrencies } from "../data/currencies";
import { isDomainAllowed } from "../services/domainRules";
import {
  getExchangeRates,
  getCachedExchangeRateStatus,
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
import { getActiveTabHostname, setSiteAllowed } from "../services/siteControls";
import type { UserSettings } from "../types/settings";
import {
  copyManualConversion,
  formatManualConversionInput,
} from "../popup/manualConversion";
import { refreshRateStatus } from "../popup/rateStatus";
import { getManualFeedback, type ManualFeedback } from "./manualFeedback";

const MANUAL_CONVERSION_DEBOUNCE_MS = 250;
const COPY_FEEDBACK_DURATION_MS = 900;

export type SettingsSurface = "popup" | "options";

export type SettingsControllerDependencies = {
  getSettings: typeof getSettings;
  saveSettings: typeof saveSettings;
  notifyActiveTabSettingsChanged: typeof notifyActiveTabSettingsChanged;
  getActiveTabHostname: typeof getActiveTabHostname;
  setSiteAllowed: typeof setSiteAllowed;
  isDomainAllowed: typeof isDomainAllowed;
  getExchangeRates: typeof getExchangeRates;
  getCachedExchangeRateStatus: typeof getCachedExchangeRateStatus;
  getExchangeRateStatus: typeof getExchangeRateStatus;
  refreshExchangeRates: typeof refreshExchangeRates;
  refreshRateStatus: typeof refreshRateStatus;
  getManualConversion: typeof getManualConversion;
  copyManualConversion: typeof copyManualConversion;
  formatManualConversionInput: typeof formatManualConversionInput;
  openOptionsPage: () => Promise<void>;
};

const defaultDependencies: SettingsControllerDependencies = {
  getSettings,
  saveSettings,
  notifyActiveTabSettingsChanged,
  getActiveTabHostname,
  setSiteAllowed,
  isDomainAllowed,
  getExchangeRates,
  getCachedExchangeRateStatus,
  getExchangeRateStatus,
  refreshExchangeRates,
  refreshRateStatus,
  getManualConversion,
  copyManualConversion,
  formatManualConversionInput,
  openOptionsPage: () => chrome.runtime.openOptionsPage(),
};

const sortedCurrencies = [...fiatCurrencies].sort((left, right) =>
  left.code.localeCompare(right.code)
);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function normalizeDomains(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
}

function domainsAreEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((domain, index) => domain === right[index])
  );
}

export type SettingsController = {
  settings: UserSettings | null;
  currencies: typeof sortedCurrencies;
  whitelistDraft: string;
  blacklistDraft: string;
  error: string | null;
  isLoading: boolean;
  isSaving: boolean;
  controlsDisabled: boolean;
  currentHostname: string | null;
  currentSiteIsAllowed: boolean;
  manualInput: string;
  manualResult: ManualConversionResult | null;
  manualFeedback: ManualFeedback | null;
  isManualConverting: boolean;
  copyLabel: string;
  manualInputRef: React.RefObject<HTMLInputElement | null>;
  rateStatus: ExchangeRateStatus;
  isRefreshingRates: boolean;
  showReloadNotice: boolean;
  settingsApplyStatus: string;
  showPopupStatus: boolean;
  updateSettings: (settings: UserSettings) => void;
  updateSetting: <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => void;
  updateTargetCurrency: (targetCurrency: string) => void;
  updateDomains: (key: "whitelist" | "blacklist", value: string) => void;
  setCurrentSiteEnabled: (enabled: boolean) => void;
  updateManualInput: (value: string) => void;
  formatManualInput: (value: string) => void;
  formatPastedManualInput: () => void;
  copyManualResult: () => void;
  refreshRates: () => void;
  openOptionsPage: () => void;
};

export function useSettingsController(
  surface: SettingsSurface,
  dependencies: SettingsControllerDependencies = defaultDependencies
): SettingsController {
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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hostnameRequest =
      surface === "popup"
        ? dependencies.getActiveTabHostname()
        : Promise.resolve(null);

    void Promise.all([dependencies.getSettings(), hostnameRequest])
      .then(async ([loadedSettings, hostname]) => {
        if (cancelled) return;

        settingsRef.current = loadedSettings;
        setSettings(loadedSettings);
        setCurrentHostname(hostname);
        setWhitelistDraft(loadedSettings.whitelist.join("\n"));
        setBlacklistDraft(loadedSettings.blacklist.join("\n"));

        const statusRequestId = rateRefreshIdRef.current + 1;
        rateRefreshIdRef.current = statusRequestId;
        const hydratedStatus = await dependencies
          .getCachedExchangeRateStatus(loadedSettings.targetCurrency)
          .catch(() => dependencies.getExchangeRateStatus(loadedSettings.targetCurrency));
        if (
          !cancelled &&
          mountedRef.current &&
          rateRefreshIdRef.current === statusRequestId &&
          settingsRef.current?.targetCurrency === loadedSettings.targetCurrency
        ) {
          setRateStatus(hydratedStatus);
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
  }, [dependencies, surface]);

  useEffect(() => {
    let cancelled = false;
    const value = manualInput.trim();

    if (!settings || !value || !settings.enabled) {
      return;
    }

    const timer = setTimeout(() => {
      setIsManualConverting(true);
      void dependencies
        .getManualConversion(value, settings, {
          async getRates(baseCurrency) {
            try {
              return (
                await dependencies.getExchangeRates(baseCurrency)
              ).rates;
            } finally {
              if (!cancelled) {
                setRateStatus(
                  dependencies.getExchangeRateStatus(baseCurrency)
                );
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
  }, [dependencies, manualInput, settings]);

  function updateSettings(nextSettings: UserSettings): void {
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
        await dependencies.saveSettings(nextSettings);
        const applied =
          surface === "popup"
            ? await dependencies.notifyActiveTabSettingsChanged()
            : true;

        if (
          mountedRef.current &&
          saveVersionRef.current === saveVersion
        ) {
          setError(null);
          setShowReloadNotice(!applied);
        }
      });

    saveQueueRef.current = saveOperation;

    void saveOperation
      .catch((saveError: unknown) => {
        if (
          mountedRef.current &&
          saveVersionRef.current === saveVersion
        ) {
          setError(getErrorMessage(saveError));
        }
      })
      .finally(() => {
        if (
          mountedRef.current &&
          saveVersionRef.current === saveVersion
        ) {
          setIsSaving(false);
        }
      });
  }

  function updateSetting<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ): void {
    const currentSettings = settingsRef.current;
    if (currentSettings) {
      updateSettings({ ...currentSettings, [key]: value });
    }
  }

  function updateTargetCurrency(targetCurrency: string): void {
    const currentSettings = settingsRef.current;
    if (!currentSettings) {
      return;
    }

    const statusRequestId = rateRefreshIdRef.current + 1;
    rateRefreshIdRef.current = statusRequestId;
    setIsRefreshingRates(false);
    setRateStatus(dependencies.getExchangeRateStatus(targetCurrency));
    updateSettings({ ...currentSettings, targetCurrency });

    void dependencies
      .getCachedExchangeRateStatus(targetCurrency)
      .then((hydratedStatus) => {
        if (
          mountedRef.current &&
          rateRefreshIdRef.current === statusRequestId &&
          settingsRef.current?.targetCurrency === targetCurrency
        ) {
          setRateStatus(hydratedStatus);
        }
      })
      .catch(() => undefined);
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
      updateSettings({ ...currentSettings, [key]: domains });
    }
  }

  function setCurrentSiteEnabled(enabled: boolean): void {
    const currentSettings = settingsRef.current;
    if (!currentSettings || !currentHostname) {
      return;
    }

    const nextSettings = dependencies.setSiteAllowed(
      currentSettings,
      currentHostname,
      enabled
    );
    setWhitelistDraft(nextSettings.whitelist.join("\n"));
    setBlacklistDraft(nextSettings.blacklist.join("\n"));
    updateSettings(nextSettings);
  }

  function updateManualInput(value: string): void {
    setManualInput(value);
    setManualResult(null);
    setCopyLabel("Copy");
    setIsManualConverting(Boolean(value.trim()) && Boolean(settings?.enabled));
  }

  function formatManualInput(value: string): void {
    const formatted = dependencies.formatManualConversionInput(value);
    if (formatted !== value) {
      updateManualInput(formatted);
    }
  }

  function formatPastedManualInput(): void {
    setTimeout(() => {
      const value = manualInputRef.current?.value;
      if (value !== undefined && mountedRef.current) {
        formatManualInput(value);
      }
    }, 0);
  }

  function copyManualResult(): void {
    if (!manualResult) {
      return;
    }

    void dependencies.copyManualConversion(manualResult.converted).then((copied) => {
      if (!copied || !mountedRef.current) {
        return;
      }

      setCopyLabel("Copied");
      setTimeout(() => {
        if (mountedRef.current) {
          setCopyLabel("Copy");
        }
      }, COPY_FEEDBACK_DURATION_MS);
    });
  }

  function refreshRates(): void {
    const baseCurrency = settingsRef.current?.targetCurrency;
    if (!baseCurrency) {
      return;
    }

    const refreshId = rateRefreshIdRef.current + 1;
    rateRefreshIdRef.current = refreshId;
    setIsRefreshingRates(true);

    void dependencies
      .refreshRateStatus(baseCurrency, dependencies.refreshExchangeRates)
      .catch(() => undefined)
      .finally(() => {
        if (
          !mountedRef.current ||
          rateRefreshIdRef.current !== refreshId
        ) {
          return;
        }

        if (settingsRef.current?.targetCurrency === baseCurrency) {
          setRateStatus(dependencies.getExchangeRateStatus(baseCurrency));
        }
        setIsRefreshingRates(false);
      });
  }

  function openOptionsPage(): void {
    void dependencies.openOptionsPage().catch((openError: unknown) => {
      if (mountedRef.current) {
        setError(getErrorMessage(openError));
      }
    });
  }

  const controlsDisabled = !settings?.enabled || isSaving;
  const currentSiteIsAllowed = Boolean(
    settings &&
      currentHostname &&
      dependencies.isDomainAllowed(currentHostname, settings)
  );
  const manualFeedback = settings
    ? getManualFeedback(manualInput, settings, rateStatus)
    : null;
  const settingsApplyStatus = formatSettingsApplyStatus(
    isSaving,
    showReloadNotice
  );

  return {
    settings,
    currencies: sortedCurrencies,
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
    showReloadNotice,
    settingsApplyStatus,
    showPopupStatus: Boolean(error) || isSaving || showReloadNotice,
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
  };
}
