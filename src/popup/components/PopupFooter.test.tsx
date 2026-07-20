import {
  createElement,
  expect,
  expectEqual,
  mount,
} from "../../components/ui/test-harness";
import type { CombinedRateStatus, IranianBridgeStatus } from "../rateStatus";

Object.defineProperty(globalThis, "React", {
  configurable: true,
  value: await import("react"),
});
const { PopupFooter } = await import("./PopupFooter");

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

function footer(iranianBridgeStatus: IranianBridgeStatus) {
  return createElement(PopupFooter, {
    rateStatus: status(iranianBridgeStatus),
    error: null,
    showSaveStatus: false,
    saveStatus: "Saved",
  });
}

const view = await mount(footer({ state: "fresh", updatedAt }));
const globalLines = document.querySelectorAll(
  '[aria-label="Exchange rate status"] p > span'
);
const iranianLines = document.querySelectorAll(
  '[aria-label="Iranian rate status"] p > span'
);
expectEqual(globalLines.length, 2, "popup global status has two lines");
expectEqual(iranianLines.length, 2, "popup Iranian status has two lines");
expectEqual(
  globalLines[0]?.className,
  iranianLines[0]?.className,
  "popup primary status typography matches"
);
expectEqual(
  globalLines[1]?.className,
  iranianLines[1]?.className,
  "popup secondary status typography matches"
);
expect(iranianLines[0]?.textContent?.startsWith("Updated "), "popup Iranian update time");
expectEqual(iranianLines[1]?.textContent, "Ehinium source", "popup Iranian source");
expectEqual(
  document.querySelector('[aria-label="Iranian rate status"]')?.textContent?.includes("Iranian rate"),
  false,
  "popup fresh status omits Iranian prefix"
);

await view.rerender(footer({ state: "stale", updatedAt }));
expect(
  document.querySelectorAll('[aria-label="Iranian rate status"] p > span')[0]?.textContent?.startsWith("Updated "),
  "popup stale status keeps update time"
);
expectEqual(
  document.querySelectorAll('[aria-label="Iranian rate status"] p > span')[1]?.textContent,
  "Cached Ehinium source",
  "popup stale source"
);

await view.rerender(footer({ state: "loading" }));
expectEqual(
  document.querySelector('[aria-label="Iranian rate status"]')?.textContent,
  "Loading Iranian rate...",
  "popup loading copy"
);

for (const [state, copy] of [
  ["unavailable", "Iranian rate unavailable"],
  ["misconfigured", "Iranian rate configuration unavailable"],
] as const) {
  await view.rerender(footer({ state }));
  expect(
    document.querySelector('[aria-label="Iranian rate status"]')?.textContent?.includes(copy),
    `popup ${state} copy remains visible`
  );
}

await view.unmount();
