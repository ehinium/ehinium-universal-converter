import { Label } from "./label";
import { NativeSelect } from "./native-select";
import {
  act,
  browserWindow,
  createElement,
  createRef,
  expect,
  expectEqual,
  mount,
} from "./test-harness";

let selectedValue = "EUR";
const ref = createRef<HTMLSelectElement>();
const view = await mount(
  createElement(
    "div",
    null,
    createElement(Label, { htmlFor: "currency" }, "Target currency"),
    createElement(
      NativeSelect,
      {
        ref,
        id: "currency",
        value: selectedValue,
        onChange: (event) => {
          selectedValue = event.currentTarget.value;
        },
      },
      createElement("option", { value: "EUR" }, "Euro"),
      createElement("option", { value: "USD" }, "US Dollar")
    )
  )
);
const select = document.querySelector<HTMLSelectElement>("select");

expect(select, "native select renders");
expectEqual(select.labels?.[0]?.textContent, "Target currency", "label integration");
expectEqual(ref.current, select, "native select ref forwarding");
expect(select.className.includes("appearance-none"), "native indicator is hidden");
expect(
  document.querySelector("svg")?.classList.contains("pointer-events-none"),
  "replacement indicator does not block pointer input"
);

await act(async () => {
  select.value = "USD";
  select.dispatchEvent(
    new browserWindow.Event("change", { bubbles: true }) as unknown as Event
  );
});
expectEqual(selectedValue, "USD", "native value change");
await view.unmount();

const disabledView = await mount(
  createElement(
    NativeSelect,
    { disabled: true, "aria-invalid": true },
    createElement("option", null, "Unavailable")
  )
);
const disabledSelect = document.querySelector<HTMLSelectElement>("select");
expect(disabledSelect, "disabled select renders");
expectEqual(disabledSelect.disabled, true, "disabled native select behavior");
expectEqual(disabledSelect.getAttribute("aria-invalid"), "true", "invalid select state");
await disabledView.unmount();
