import {
  act,
  createElement,
  expect,
  expectEqual,
  flush,
  mount,
} from "../components/ui/test-harness";
import type { NormalizedRatesResponse } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { useLayoutEffect } from "react";
import { normalizeSettings } from "../services/settings";
import {
  useSettingsController,
  type SettingsController,
  type SettingsControllerDependencies,
  type SettingsSurface,
} from "./useSettingsController";

const initialSettings = normalizeSettings({
  targetCurrency: "usd",
  whitelist: ["allowed.example"],
});

const rateResponse: NormalizedRatesResponse = {
  base: "USD",
  date: "2026-07-16",
  rates: { USD: 1, EUR: 0.92 },
  provider: "frankfurter",
};

function createDependencies(
  overrides: Partial<SettingsControllerDependencies> = {}
): SettingsControllerDependencies {
  return {
    getSettings: async () => initialSettings,
    saveSettings: async () => undefined,
    notifyActiveTabSettingsChanged: async () => true,
    getActiveTabHostname: async () => "shop.example.com",
    setSiteAllowed: (settings, hostname, enabled) => ({
      ...settings,
      blacklist: enabled ? [] : [...settings.blacklist, hostname],
    }),
    isDomainAllowed: () => true,
    getExchangeRates: async () => rateResponse,
    getExchangeRateStatus: () => ({
      response: rateResponse,
      fetchedAt: 1,
      lastErrorAt: null,
    }),
    refreshExchangeRates: async () => rateResponse,
    refreshRateStatus: async (baseCurrency, fetcher) => {
      await fetcher(baseCurrency);
    },
    getManualConversion: async () => null,
    copyManualConversion: async () => true,
    formatManualConversionInput: (value) => value.trim(),
    openOptionsPage: async () => undefined,
    ...overrides,
  };
}

let latestController: SettingsController | null = null;

function captureController(controller: SettingsController): void {
  latestController = controller;
}

function ControllerProbe({
  surface,
  dependencies,
}: {
  surface: SettingsSurface;
  dependencies: SettingsControllerDependencies;
}) {
  const controller = useSettingsController(surface, dependencies);
  useLayoutEffect(() => {
    captureController(controller);
  }, [controller]);
  return createElement("output", {
    "data-loading": controller.isLoading,
    "data-saving": controller.isSaving,
  });
}

function getController(): SettingsController {
  expect(latestController, "controller should be available after render");
  return latestController;
}

const saveStarts: UserSettings[] = [];
const saveResolvers: Array<() => void> = [];
let popupNotifications = 0;
let rateRefreshes = 0;
let resolveInitialLoad: ((settings: UserSettings) => void) | undefined;

const popupDependencies = createDependencies({
  getSettings: () =>
    new Promise<UserSettings>((resolve) => {
      resolveInitialLoad = resolve;
    }),
  saveSettings: async (settings) => {
    saveStarts.push(settings);
    await new Promise<void>((resolve) => saveResolvers.push(resolve));
  },
  notifyActiveTabSettingsChanged: async () => {
    popupNotifications += 1;
    return true;
  },
  refreshExchangeRates: async () => {
    rateRefreshes += 1;
    return rateResponse;
  },
});

let view = await mount(
  createElement(ControllerProbe, {
    surface: "popup",
    dependencies: popupDependencies,
  })
);

expectEqual(getController().isLoading, true, "initial loading state");
resolveInitialLoad?.(initialSettings);
await flush();
expectEqual(getController().isLoading, false, "settings load completes");
expectEqual(
  getController().settings?.targetCurrency,
  "USD",
  "normalized settings reach controller state"
);
expectEqual(
  getController().currentHostname,
  "shop.example.com",
  "popup hostname load"
);
expectEqual(getController().currentSiteIsAllowed, true, "current site state");

await act(async () => {
  getController().updateSetting("badgeStyle", "compact");
});
await flush();
expectEqual(getController().isSaving, true, "save-pending state");
expectEqual(saveStarts.length, 1, "first save starts");

await act(async () => {
  getController().updateSetting("badgeVisibility", "hover");
});
await flush();
expectEqual(saveStarts.length, 1, "second save waits for first");

await act(async () => saveResolvers.shift()?.());
await flush();
expectEqual(saveStarts.length, 2, "second serialized save starts");
expectEqual(popupNotifications, 1, "popup notifies after first write");

await act(async () => saveResolvers.shift()?.());
await flush();
expectEqual(getController().isSaving, false, "save queue completion");
expectEqual(popupNotifications, 2, "popup notifies after each write");
expectEqual(
  getController().settings?.badgeVisibility,
  "hover",
  "successful optimistic update remains current"
);

await act(async () => {
  getController().setCurrentSiteEnabled(false);
});
await flush();
expectEqual(
  getController().settings?.blacklist.includes("shop.example.com"),
  true,
  "current-site action uses site service result"
);
await act(async () => saveResolvers.shift()?.());
await flush();

await act(async () => {
  getController().updateDomains(
    "whitelist",
    "first.example\n second.example \n"
  );
});
await flush();
expectEqual(
  getController().whitelistDraft,
  "first.example\n second.example \n",
  "domain draft preserves textarea input"
);
expectEqual(
  JSON.stringify(getController().settings?.whitelist),
  JSON.stringify(["first.example", "second.example"]),
  "meaningful domain input is normalized and persisted"
);
await act(async () => saveResolvers.shift()?.());
await flush();

await act(async () => {
  getController().refreshRates();
});
await flush();
expectEqual(rateRefreshes, 1, "rate refresh wiring");
expectEqual(getController().isRefreshingRates, false, "rate refresh completion");
expectEqual(getController().rateStatus.response?.base, "USD", "rate status reload");
await view.unmount();

let failedSaveAttempts = 0;
const failureDependencies = createDependencies({
  saveSettings: async () => {
    failedSaveAttempts += 1;
    throw new Error("Sync storage failed");
  },
});

view = await mount(
  createElement(ControllerProbe, {
    surface: "popup",
    dependencies: failureDependencies,
  })
);
await flush();
await act(async () => {
  getController().updateSetting("badgeStyle", "minimal");
});
await flush();
expectEqual(failedSaveAttempts, 1, "failed save attempted");
expectEqual(getController().error, "Sync storage failed", "failed update error");
expectEqual(getController().isSaving, false, "failed save clears pending state");
await view.unmount();

let optionNotifications = 0;
const optionsDependencies = createDependencies({
  notifyActiveTabSettingsChanged: async () => {
    optionNotifications += 1;
    return true;
  },
});

view = await mount(
  createElement(ControllerProbe, {
    surface: "options",
    dependencies: optionsDependencies,
  })
);
await flush();
expectEqual(getController().currentHostname, null, "options skips hostname lookup");
await act(async () => {
  getController().updateSetting("unitSystem", "metric");
});
await flush();
expectEqual(optionNotifications, 0, "options skips popup-only notification");
await view.unmount();

let resolveStaleLoad: ((settings: UserSettings) => void) | undefined;
const staleDependencies = createDependencies({
  getSettings: () =>
    new Promise<UserSettings>((resolve) => {
      resolveStaleLoad = resolve;
    }),
});

view = await mount(
  createElement(ControllerProbe, {
    surface: "options",
    dependencies: staleDependencies,
  })
);
expectEqual(getController().isLoading, true, "stale-load test begins loading");
await view.unmount();
resolveStaleLoad?.(initialSettings);
await flush();
expectEqual(getController().isLoading, true, "unmounted load result is ignored");
