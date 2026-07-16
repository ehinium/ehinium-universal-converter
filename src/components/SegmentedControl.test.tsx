import { useState } from "react";
import type { ConverterMode } from "../types/settings";
import { conversionModeOptions } from "../settings/conversion-mode-options";
import { SegmentedControl } from "./SegmentedControl";
import {
  act,
  createElement,
  expect,
  expectEqual,
  mount,
  pressKey,
} from "./ui/test-harness";

const changes: ConverterMode[] = [];

function ControlledMode() {
  const [value, setValue] = useState<ConverterMode>("units");
  return createElement(SegmentedControl<ConverterMode>, {
    items: conversionModeOptions,
    value,
    ariaLabel: "Conversion mode",
    onValueChange: (nextValue) => {
      changes.push(nextValue);
      setValue(nextValue);
    },
  });
}

let view = await mount(createElement(ControlledMode));
const group = document.querySelector<HTMLElement>('[data-slot="radio-group"]');
let items = Array.from(document.querySelectorAll<HTMLInputElement>('[data-slot="radio-group-item"]'));
expect(group, "radio group renders");
expect(group.className.includes("grid-cols-3"), "three equal segments");
expect(group.className.includes("bg-muted"), "neutral connected container");
expect(group.className.includes("h-10"), "40px connected outer height");
expect(group.className.includes("rounded-lg"), "consistent outer radius");
expect(group.className.includes("p-1"), "even 4px outer padding");
expectEqual(Array.from(document.querySelectorAll("label > span")).map((item) => item.textContent).join(","), "Currency,Units,Everything", "mode labels");
expectEqual(items[1].getAttribute("data-state"), "checked", "legacy units selection");
const segments = Array.from(document.querySelectorAll<HTMLElement>("label > span"));
expect(segments.every((segment) => segment.className.includes("h-8") && segment.className.includes("w-full")), "equal compact segment geometry");
expect(segments[1].className.includes("bg-background") && segments[1].className.includes("text-foreground"), "selected segment uses a raised neutral surface");
expect(segments[1].className.includes("shadow-sm"), "selected segment uses a subtle shadow");
expect(segments[0].className.includes("bg-transparent") && segments[0].className.includes("text-muted-foreground"), "unselected segment remains readable");
expect(!segments[1].className.includes("bg-primary"), "selected segment does not use the brand surface");
expect(!segments[1].className.includes("bg-foreground") && !segments[1].className.includes("text-background"), "selected segment does not use foreground/background inversion");

await act(async () => items[2].click());
expectEqual(changes.at(-1), "everything", "Everything value mapping");
items = Array.from(document.querySelectorAll<HTMLInputElement>('[data-slot="radio-group-item"]'));
await act(async () => items[2].focus());
await pressKey(items[2], "ArrowRight");
expectEqual(document.activeElement, items[0], "ArrowRight wraps roving focus");
await pressKey(items[0], "End");
expectEqual(document.activeElement, items[2], "End moves focus to the final item");
await pressKey(items[2], "Home");
expectEqual(document.activeElement, items[0], "Home moves focus to the first item");
await view.unmount();

let disabledChanges = 0;
view = await mount(
  createElement(SegmentedControl<ConverterMode>, {
    items: conversionModeOptions,
    value: "units",
    disabled: true,
    ariaLabel: "Disabled conversion mode",
    onValueChange: () => { disabledChanges += 1; },
  })
);
items = Array.from(document.querySelectorAll<HTMLInputElement>('[data-slot="radio-group-item"]'));
expect(items.every((item) => item.disabled), "Disabled control should disable every item");
await act(async () => items[0].click());
expectEqual(disabledChanges, 0, "Disabled control should not emit changes");
await view.unmount();
