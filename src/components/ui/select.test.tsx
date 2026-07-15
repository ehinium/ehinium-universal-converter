import {
  act,
  createElement,
  expect,
  expectEqual,
  flush,
  mount,
  pressKey,
} from "./test-harness";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

let selectedValue = "eur";

function renderSelect(disabled = false) {
  return createElement(
    "div",
    null,
    createElement("span", { id: "currency-label" }, "Target currency"),
    createElement(
      Select,
      {
        defaultValue: "eur",
        onValueChange: (value: string) => {
          selectedValue = value;
        },
        disabled,
      },
      createElement(
        SelectTrigger,
        { "aria-labelledby": "currency-label" },
        createElement(SelectValue, { placeholder: "Choose currency" })
      ),
      createElement(
        SelectContent,
        null,
        createElement(SelectItem, { value: "eur" }, "Euro"),
        createElement(SelectItem, { value: "usd" }, "US Dollar"),
        createElement(SelectItem, { value: "gbp" }, "British Pound"),
        ...Array.from({ length: 20 }, (_, index) =>
          createElement(
            SelectItem,
            { key: `extra-${index}`, value: `extra-${index}` },
            `Extra currency ${index + 1}`
          )
        )
      )
    )
  );
}

const view = await mount(renderSelect());
const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]');
expect(trigger, "select trigger renders");
expectEqual(trigger.getAttribute("aria-labelledby"), "currency-label", "trigger accessible name");

trigger.focus();
await pressKey(trigger, "ArrowDown");
let listbox = document.querySelector<HTMLElement>('[role="listbox"]');
expect(listbox, "keyboard opens select content");
expect(document.body.contains(listbox), "portal content renders under document body");
expect(!view.container.contains(listbox), "portal content escapes ancestor container");
expect(
  listbox.className.includes("max-h-[var(--radix-select-content-available-height)]"),
  "content is constrained to available height"
);

const activeItem = document.activeElement;
expect(activeItem, "an item receives focus when select opens");
await pressKey(activeItem, "ArrowDown");
await pressKey(document.activeElement ?? activeItem, "Enter");
expectEqual(selectedValue, "usd", "arrow navigation and Enter select an item");
expectEqual(document.querySelector('[role="listbox"]'), null, "selection closes content");
expectEqual(document.activeElement, trigger, "selection restores trigger focus");

await pressKey(trigger, "ArrowDown");
listbox = document.querySelector<HTMLElement>('[role="listbox"]');
expect(listbox, "select reopens through keyboard");
await pressKey(document.activeElement ?? listbox, "Escape");
expectEqual(document.querySelector('[role="listbox"]'), null, "Escape closes content");
expectEqual(document.activeElement, trigger, "Escape restores trigger focus");

await pressKey(trigger, "ArrowDown");
await view.rerender(renderSelect());
await flush();
expectEqual(
  document.querySelectorAll('[role="listbox"]').length,
  1,
  "rerender does not duplicate portal content"
);
await pressKey(document.activeElement ?? trigger, "Escape");
await view.unmount();

const disabledView = await mount(renderSelect(true));
const disabledTrigger = document.querySelector<HTMLButtonElement>('[role="combobox"]');
expect(disabledTrigger, "disabled select trigger renders");
expectEqual(disabledTrigger.disabled, true, "disabled trigger native behavior");
await act(async () => disabledTrigger.focus());
await pressKey(disabledTrigger, "ArrowDown");
expectEqual(document.querySelector('[role="listbox"]'), null, "disabled trigger stays closed");
await disabledView.unmount();
