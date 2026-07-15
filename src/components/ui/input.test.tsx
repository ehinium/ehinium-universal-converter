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
expect(input.className.includes("aria-invalid:border-destructive"), "invalid styling");
expectEqual(ref.current, input, "input ref forwarding");

await view.unmount();
