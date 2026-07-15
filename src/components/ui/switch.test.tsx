import { Label } from "./label";
import { Switch } from "./switch";
import {
  act,
  createElement,
  createRef,
  expect,
  expectEqual,
  mount,
  pressKey,
} from "./test-harness";

const changes: boolean[] = [];
const ref = createRef<HTMLButtonElement>();
let view = await mount(
  createElement(
    "div",
    null,
    createElement(Label, { htmlFor: "converter-enabled" }, "Enable converter"),
    createElement(Switch, {
      ref,
      id: "converter-enabled",
      defaultChecked: false,
      onCheckedChange: (checked) => changes.push(checked),
    })
  )
);
let control = document.querySelector<HTMLButtonElement>('[role="switch"]');

expect(control, "switch renders with switch role");
expectEqual(control.getAttribute("aria-checked"), "false", "initial unchecked state");
expectEqual(control.labels?.[0]?.textContent, "Enable converter", "switch label integration");
expectEqual(ref.current, control, "switch ref forwarding");

control.focus();
await pressKey(control, " ");
expectEqual(control.getAttribute("aria-checked"), "true", "space key checks switch");
expectEqual(changes.at(-1), true, "keyboard activation emits checked state");

await act(async () => control?.click());
expectEqual(control.getAttribute("aria-checked"), "false", "click unchecks switch");
expectEqual(changes.at(-1), false, "click emits unchecked state");
await view.unmount();

let disabledChanges = 0;
view = await mount(
  createElement(Switch, {
    disabled: true,
    onCheckedChange: () => {
      disabledChanges += 1;
    },
    "aria-label": "Unavailable setting",
  })
);
control = document.querySelector<HTMLButtonElement>('[role="switch"]');
expect(control, "disabled switch renders");
expectEqual(control.disabled, true, "disabled switch native behavior");
await act(async () => control?.click());
expectEqual(control.getAttribute("aria-checked"), "false", "disabled switch stays unchecked");
expectEqual(disabledChanges, 0, "disabled switch emits no changes");
await view.unmount();
