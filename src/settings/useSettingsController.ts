import { useEffect, useRef, useState } from "react";
import { selectableTargetCurrencies } from "../data/currencies";
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
import {
  IranianBridgeClientError,
  requestIranianBridgeRateDetails,
} from "../services/iranianBridgeClient";
import { getSettings, saveSettings } from "../services/settings";
import {
  formatSettingsApplyStatus,
  notifyActiveTabSettingsChanged,
} from "../services/settingsApply";
import { getActiveTabHostname, setSiteAllowed } from "../services/siteControls";
import type { UserSettings } from "../types/settings";
import { parseCurrencies } from "../utils/currencyParser";
import {
  copyManualConversion,
  formatManualConversionInput,
} from "../popup/manualConversion";
import {
  getIranianBridgeStatus,
  notRequiredIranianBridgeStatus,
  refreshRateStatus,
  type CombinedRateStatus,
  type IranianBridgeStatus,
} from "../popup/rateStatus";
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
  requestIranianBridgeRateDetails: typeof requestIranianBridgeRateDetails;
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
  requestIranianBridgeRateDetails,
  getManualConversion,
  copyManualConversion,
  formatManualConversionInput,
  openOptionsPage: () => chrome.runtime.openOptionsPage(),
};

const sortedCurrencies = [...selectableTargetCurrencies].sort((left, right) =>
  left.code.localeCompare(right.code)
);

function getGlobalStatusBase(targetCurrency: string): string {
  return targetCurrency === "IRT" ? "USD" : targetCurrency;
}

function iranianStatusIsRequired(
  targetCurrency: string | undefined,
  manualInput: string
): boolean {
  if (targetCurrency === "IRT") return true;
  const source = parseCurrencies(manualInput)[0]?.currency;
  return source === "IRT" || source === "IRR";
}

function getIranianStatusError(error: unknown): IranianBridgeStatus {
  return {
    state:
      error instanceof IranianBridgeClientError &&
      error.code === "misconfigured"
        ? "misconfigured"
        : "unavailable",
  };
}

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
  rateStatus: CombinedRateStatus;
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
  const [iranianBridgeStatus, setIranianBridgeStatus] =
    useState<IranianBridgeStatus>(notRequiredIranianBridgeStatus);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [showReloadNotice, setShowReloadNotice] = useState(false);
  const settingsRef = useRef<UserSettings | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  const rateRefreshIdRef = useRef(0);
  const iranianStatusRequestIdRef = useRef(0);
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

        const statusBase = getGlobalStatusBase(loadedSettings.targetCurrency);
        const statusRequestId = rateRefreshIdRef.current + 1;
        rateRefreshIdRef.current = statusRequestId;
        const hydratedStatus = await dependencies
          .getCachedExchangeRateStatus(statusBase)
          .catch(() => dependencies.getExchangeRateStatus(statusBase));
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
    const required = iranianStatusIsRequired(
      settings?.targetCurrency,
      manualInput
    );
    const requestId = iranianStatusRequestIdRef.current + 1;
    iranianStatusRequestIdRef.current = requestId;

    if (!required) {
      setIranianBridgeStatus(notRequiredIranianBridgeStatus);
      return;
    }

    let cancelled = false;
    setIranianBridgeStatus({ state: "loading" });
    void dependencies
      .requestIranianBridgeRateDetails()
      .then((result) => {
        if (!cancelled && iranianStatusRequestIdRef.current === requestId) {
          setIranianBridgeStatus(getIranianBridgeStatus(result));
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled && iranianStatusRequestIdRef.current === requestId) {
          setIranianBridgeStatus(getIranianStatusError(requestError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dependencies, manualInput, settings?.targetCurrency]);

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
          async getGlobalRates(baseCurrency) {
            try {
              return await dependencies.getExchangeRates(baseCurrency);
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
    const statusBase = getGlobalStatusBase(targetCurrency);
    setRateStatus(dependencies.getExchangeRateStatus(statusBase));
    updateSettings({ ...currentSettings, targetCurrency });

    void dependencies
      .getCachedExchangeRateStatus(statusBase)
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

    const statusBase = getGlobalStatusBase(baseCurrency);
    const refreshId = rateRefreshIdRef.current + 1;
    rateRefreshIdRef.current = refreshId;
    setIsRefreshingRates(true);

    const refreshIranian = iranianStatusIsRequired(baseCurrency, manualInput);
    const iranianRequestId = iranianStatusRequestIdRef.current + 1;
    if (refreshIranian) {
      iranianStatusRequestIdRef.current = iranianRequestId;
      setIranianBridgeStatus({ state: "loading" });
    }

    const globalRefresh = dependencies.refreshRateStatus(
      statusBase,
      dependencies.refreshExchangeRates
    );
    const iranianRefresh = refreshIranian
      ? dependencies
          .requestIranianBridgeRateDetails({ forceRefresh: true })
          .then((result) => {
            if (iranianStatusRequestIdRef.current === iranianRequestId) {
              setIranianBridgeStatus(getIranianBridgeStatus(result));
            }
          })
          .catch((requestError: unknown) => {
            if (iranianStatusRequestIdRef.current === iranianRequestId) {
              setIranianBridgeStatus(getIranianStatusError(requestError));
            }
          })
      : Promise.resolve();

    void Promise.allSettled([globalRefresh, iranianRefresh])
      .catch(() => undefined)
      .finally(() => {
        if (
          !mountedRef.current ||
          rateRefreshIdRef.current !== refreshId
        ) {
          return;
        }

        if (settingsRef.current?.targetCurrency === baseCurrency) {
          setRateStatus(dependencies.getExchangeRateStatus(statusBase));
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
    rateStatus: { ...rateStatus, iranianBridgeStatus },
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
