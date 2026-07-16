import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Field, FieldDescription, FieldError, FieldLabel } from "./field";
import { Input } from "./input";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "./item";
import { Button } from "./button";
import { Card, CardContent } from "./card";
import { createElement, expect, expectEqual, mount } from "./test-harness";

let view = await mount(
  createElement(
    Field,
    null,
    createElement(FieldLabel, { htmlFor: "field-control" }, "Target"),
    createElement(Input, {
      id: "field-control",
      "aria-describedby": "field-help field-error",
      "aria-invalid": true,
    }),
    createElement(FieldDescription, { id: "field-help" }, "Choose a target."),
    createElement(FieldError, { id: "field-error", errors: [{ message: "Target is required." }] })
  )
);
const field = document.querySelector<HTMLElement>('[data-slot="field"]');
const input = document.querySelector<HTMLInputElement>("#field-control");
expect(field && input, "official Field composition renders");
expectEqual(input.labels?.[0]?.textContent, "Target", "Field label relationship");
expectEqual(input.getAttribute("aria-describedby"), "field-help field-error", "Field description relationship");
expectEqual(document.querySelector('[data-slot="field-error"]')?.getAttribute("role"), "alert", "Field error semantics");
expect(document.body.textContent?.includes("Target is required."), "Field error renders");
await view.unmount();

view = await mount(createElement(Card, null, createElement(CardContent, null, "Compact content")));
const card = document.querySelector<HTMLElement>('[data-slot="card"]');
expect(card, "official Card composition renders");
expect(card.className.includes("rounded-xl"), "Card retains its primitive radius");
expect(card.className.includes("border"), "Card uses one subtle border");
expect(card.className.includes("shadow-xs"), "Card uses one restrained shadow");
expect(!card.className.includes("ring-1"), "Card does not stack a ring treatment");
await view.unmount();

view = await mount(
  createElement(
    ItemGroup,
    null,
    createElement(
      Item,
      null,
      createElement(ItemContent, null, createElement(ItemTitle, null, "Version")),
      createElement(ItemActions, null, createElement(Button, { size: "sm" }, "Details"))
    )
  )
);
expectEqual(document.querySelector('[data-slot="item-group"]')?.getAttribute("role"), "list", "ItemGroup list semantics");
expect(document.querySelector('[data-slot="item"]'), "official Item renders");
expect(document.querySelector('[data-slot="item-actions"] button'), "Item actions expose their control");
await view.unmount();

view = await mount(
  createElement(
    Alert,
    { variant: "destructive" },
    createElement(AlertTitle, null, "Unavailable"),
    createElement(AlertDescription, null, "Try again.")
  )
);
expectEqual(document.querySelector('[data-slot="alert"]')?.getAttribute("role"), "alert", "Alert semantics");
expect(document.body.textContent?.includes("Try again."), "Alert description renders");
await view.unmount();
