import { Button } from "./button";
import {
  createElement,
  createRef,
  expect,
  expectEqual,
  mount,
} from "./test-harness";

const buttonRef = createRef<HTMLButtonElement>();
let view = await mount(createElement(Button, { ref: buttonRef }, "Convert"));
let button = document.querySelector<HTMLButtonElement>("button");

expect(button, "default button renders");
expectEqual(button.textContent, "Convert", "default button content");
expect(button.className.includes("bg-primary"), "default variant class");
expect(button.className.includes("h-9"), "default size class");
expectEqual(buttonRef.current, button, "button ref forwarding");
await view.unmount();

view = await mount(
  createElement(Button, { variant: "destructive", disabled: true }, "Delete")
);
button = document.querySelector<HTMLButtonElement>("button");
expect(button, "destructive button renders");
expect(button.className.includes("bg-destructive"), "destructive variant class");
expectEqual(button.disabled, true, "disabled native behavior");
await view.unmount();

const childRef = createRef<HTMLButtonElement>();
view = await mount(
  createElement(
    Button,
    { asChild: true, variant: "link", ref: childRef },
    createElement("a", { href: "#settings" }, "Settings")
  )
);
const link = document.querySelector<HTMLAnchorElement>("a");
expect(link, "asChild renders child element");
expectEqual(document.querySelector("button"), null, "asChild avoids wrapper button");
expect(link.className.includes("hover:underline"), "asChild receives variant classes");
expectEqual(childRef.current as unknown as HTMLAnchorElement, link, "asChild ref forwarding");
await view.unmount();
