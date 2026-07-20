import {
  act,
  createElement,
  expect,
  expectEqual,
  mount,
} from "../../components/ui/test-harness";
import type {
  CombinedRateStatus,
  IranianBridgeStatus,
} from "../../popup/rateStatus";

Object.defineProperty(globalThis, "React", {
  configurable: true,
  value: await import("react"),
});
const { RateStatus } = await import("./RateStatus");

const updatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function status(iranianBridgeStatus: IranianBridgeStatus): CombinedRateStatus {
  return {
    response: {
      base: "USD",
      date: "2026-07-20",
      rates: { USD: 1 },
      provider: "frankfurter+fawaz",
    },
    fetchedAt: Date.now() - 26 * 60 * 1000,
    lastErrorAt: null,
    iranianBridgeStatus,
  };
}

let refreshCalls = 0;
function component(iranianBridgeStatus: IranianBridgeStatus) {
  return createElement(RateStatus, {
    status: status(iranianBridgeStatus),
    isRefreshing: false,
    disabled: false,
    onRefresh: () => {
      refreshCalls += 1;
    },
  });
}

const view = await mount(component({ state: "fresh", updatedAt }));
const globalLines = document.querySelectorAll(
  '[aria-label="Exchange rate status"] > span:last-child > span'
);
const iranianLines = document.querySelectorAll(
  '[aria-label="Iranian rate status"] > span:last-child > span'
);
expectEqual(globalLines.length, 2, "settings global status has two lines");
expectEqual(iranianLines.length, 2, "settings Iranian status has two lines");
expectEqual(globalLines[0]?.className, iranianLines[0]?.className, "settings primary typography matches");
expectEqual(globalLines[1]?.className, iranianLines[1]?.className, "settings secondary typography matches");
expect(iranianLines[0]?.textContent?.startsWith("Updated "), "settings Iranian update time");
expectEqual(iranianLines[1]?.textContent, "Ehinium source", "settings Iranian source");
expectEqual(
  document.querySelector('[aria-label="Iranian rate status"]')?.textContent?.includes("Iranian rate"),
  false,
  "settings fresh status omits Iranian prefix"
);

const refreshButton = document.querySelector<HTMLButtonElement>("button");
expect(refreshButton, "settings refresh button exists");
await act(async () => refreshButton.click());
expectEqual(refreshCalls, 1, "settings refresh behavior is unchanged");

await view.rerender(component({ state: "stale", updatedAt }));
expect(
  document.querySelectorAll('[aria-label="Iranian rate status"] > span:last-child > span')[0]?.textContent?.startsWith("Updated "),
  "settings stale status keeps update time"
);
expectEqual(
  document.querySelectorAll('[aria-label="Iranian rate status"] > span:last-child > span')[1]?.textContent,
  "Cached Ehinium source",
  "settings stale source"
);

await view.rerender(component({ state: "loading" }));
expectEqual(
  document.querySelector('[aria-label="Iranian rate status"]')?.textContent,
  "Loading Iranian rate...",
  "settings loading copy"
);

for (const [state, copy] of [
  ["unavailable", "Iranian rate unavailable"],
  ["misconfigured", "Iranian rate configuration unavailable"],
] as const) {
  await view.rerender(component({ state }));
  expect(
    document.querySelector('[aria-label="Iranian rate status"]')?.textContent?.includes(copy),
    `settings ${state} copy remains visible`
  );
}

await view.unmount();
