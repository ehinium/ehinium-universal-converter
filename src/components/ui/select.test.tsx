import { useState } from "react";
import {
  act,
  browserWindow,
  createElement,
  expect,
  expectEqual,
  mount,
  pressKey,
} from "./test-harness";

const { Input } = await import("./input");
const {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} = await import("./select");

const options = ["EUR", "GBP", "USD"] as const;

function ControlledSelect() {
  const [value, setValue] = useState("EUR");

  return createElement(
    "div",
    null,
    createElement(Input, { id: "amount" }),
    createElement(
      Select,
      { value, onValueChange: setValue },
      createElement(
        SelectTrigger,
        { id: "currency", className: "w-full" },
        createElement(SelectValue, null, value)
      ),
      createElement(
        SelectContent,
        { position: "popper", collisionPadding: 8 },
        ...options.map((option) =>
          createElement(SelectItem, { key: option, value: option }, option)
        )
      )
    )
  );
}

const view = await mount(createElement(ControlledSelect));
const input = document.querySelector<HTMLInputElement>('[data-slot="input"]');
const trigger = document.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');

expect(input, "input renders");
expect(trigger, "select trigger renders");
expect(input.className.includes("h-9") && trigger.className.includes("data-[size=default]:h-9"), "Input and SelectTrigger share the official default height");
expect(input.className.includes("rounded-md") && trigger.className.includes("rounded-md"), "Input and SelectTrigger share the official radius");
expect(input.className.includes("border-input") && trigger.className.includes("border-input"), "Input and SelectTrigger share the official border");
expect(input.className.includes("focus-visible:ring-[3px]") && trigger.className.includes("focus-visible:ring-[3px]"), "Input and SelectTrigger share the official focus ring");
expectEqual(trigger.textContent?.trim(), "EUR", "controlled selected value renders");

await act(async () => {
  trigger.focus();
  trigger.dispatchEvent(new browserWindow.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }) as unknown as PointerEvent);
});
expect(document.querySelector('[data-slot="select-content"]'), "keyboard opens the Radix content portal");
expectEqual(document.querySelectorAll('[data-slot="select-item"]').length, options.length, "all options render in the portal");
const usd = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')).find((item) => item.textContent?.includes("USD"));
expect(usd, "USD option renders");
expect(document.activeElement?.textContent?.includes("EUR"), "selected option receives focus when the list opens");
await pressKey(document.activeElement!, "ArrowDown");
expect(document.activeElement?.textContent?.includes("GBP"), "ArrowDown moves through options");
await pressKey(document.activeElement!, "u");
expectEqual(document.activeElement, usd, "typeahead focuses the matching option");
await pressKey(usd, "Enter");
expectEqual(trigger.textContent?.trim(), "USD", "selected value persists in the controlled trigger");
expectEqual(document.querySelector('[data-slot="select-content"]'), null, "selection closes the portal");
expectEqual(document.activeElement, trigger, "selection restores trigger focus");

await act(async () => {
  trigger.dispatchEvent(new browserWindow.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }) as unknown as PointerEvent);
});
const portalCount = document.querySelectorAll('[data-slot="select-content"]').length;
await view.rerender(createElement(ControlledSelect));
expectEqual(document.querySelectorAll('[data-slot="select-content"]').length, portalCount, "rerender does not duplicate the portal");
await pressKey(document.querySelector<HTMLElement>('[data-slot="select-content"]')!, "Escape");
expectEqual(document.querySelector('[data-slot="select-content"]'), null, "Escape closes the dropdown");
expectEqual(document.activeElement, trigger, "Escape restores trigger focus");

await view.unmount();

const disabledView = await mount(
  createElement(
    Select,
    { value: "EUR", disabled: true },
    createElement(SelectTrigger, { "aria-invalid": true }, createElement(SelectValue, null, "EUR")),
    createElement(SelectContent, null, createElement(SelectItem, { value: "EUR" }, "EUR"))
  )
);
const disabledTrigger = document.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]');
expect(disabledTrigger, "disabled trigger renders");
expectEqual(disabledTrigger.disabled, true, "root disabled state reaches the trigger");
expectEqual(disabledTrigger.getAttribute("aria-invalid"), "true", "invalid state reaches the trigger");
expect(disabledTrigger.className.includes("aria-invalid:border-destructive"), "official invalid SelectTrigger styling");
await disabledView.unmount();
