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
expect(control.className.includes("data-[size=default]:h-[18.4px]"), "official default switch track height");
expect(control.className.includes("data-[size=default]:w-[32px]"), "official default switch track width");
expect(control.className.includes("data-[state=checked]:bg-foreground"), "checked track uses neutral foreground");
expect(!control.className.includes("data-[state=checked]:bg-primary"), "checked track does not use the brand color");
expect(!/(?:^|\s)(?:p|px|pl|pr)-/u.test(control.className), "switch root has no custom padding");
const thumb = control.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
expect(thumb, "official switch thumb renders");
expect(thumb.className.includes("group-data-[size=default]/switch:size-4"), "official default switch thumb size");
expect(thumb.className.includes("bg-background"), "thumb uses inverse semantic background");
expect(thumb.className.includes("group-data-[size=default]/switch:data-[state=checked]:translate-x-[calc(100%-2px)]"), "official checked thumb translation");
expect(thumb.className.includes("group-data-[size=default]/switch:data-[state=unchecked]:translate-x-0"), "official unchecked thumb translation");

control.focus();
await pressKey(control, " ");
expectEqual(control.getAttribute("aria-checked"), "true", "space key checks switch");
expectEqual(changes.at(-1), true, "keyboard activation emits checked state");

await act(async () => control?.click());
expectEqual(control.getAttribute("aria-checked"), "false", "click unchecks switch");
expectEqual(changes.at(-1), false, "click emits unchecked state");
await view.unmount();

view = await mount(
  createElement(Switch, {
    size: "sm",
    "aria-label": "Compact switch",
  })
);
control = document.querySelector<HTMLButtonElement>('[role="switch"]');
expect(control, "small switch renders");
expect(control.className.includes("data-[size=sm]:h-[14px]"), "official small switch track height");
expect(control.className.includes("data-[size=sm]:w-[24px]"), "official small switch track width");
const smallThumb = control.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
expect(smallThumb?.className.includes("group-data-[size=sm]/switch:size-3"), "official small thumb size");
expect(smallThumb?.className.includes("group-data-[size=sm]/switch:data-[state=checked]:translate-x-[calc(100%-2px)]"), "official small checked translation");
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
