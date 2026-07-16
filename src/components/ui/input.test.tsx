import { Input } from "./input";
import {
  createElement,
  createRef,
  expect,
  expectEqual,
  mount,
} from "./test-harness";

const ref = createRef<HTMLInputElement>();
const view = await mount(
  createElement(Input, {
    ref,
    id: "amount",
    name: "amount",
    type: "text",
    placeholder: "100 EUR",
    disabled: true,
    "aria-invalid": true,
  })
);
const input = document.querySelector<HTMLInputElement>("input");

expect(input, "input renders");
expectEqual(input.id, "amount", "standard id prop");
expectEqual(input.name, "amount", "standard name prop");
expectEqual(input.placeholder, "100 EUR", "placeholder prop");
expectEqual(input.disabled, true, "disabled prop");
expectEqual(input.getAttribute("aria-invalid"), "true", "invalid state");
expect(input.className.includes("h-9") && input.className.includes("rounded-md"), "official default Input geometry");
expect(input.className.includes("selection:bg-primary"), "official selection colors");
expect(input.className.includes("focus-visible:ring-[3px]"), "shared focus-visible styling");
expect(input.className.includes("aria-invalid:border-destructive"), "official invalid border styling");
expect(!input.className.includes("disabled:bg-input/50"), "Input has no obsolete custom disabled surface");
expectEqual(ref.current, input, "input ref forwarding");

await view.unmount();
