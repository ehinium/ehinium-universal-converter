import * as React from "react";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { cn } from "../lib/utils";

export type SegmentedControlItem<Value extends string> = {
  value: Value;
  label: React.ReactNode;
};

export type SegmentedControlProps<Value extends string> = {
  id?: string;
  items: ReadonlyArray<SegmentedControlItem<Value>>;
  value: Value;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaBusy?: boolean;
  className?: string;
  onValueChange: (value: Value) => void;
};

export function SegmentedControl<Value extends string>({
  id,
  items,
  value,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  ariaBusy,
  className,
  onValueChange,
}: SegmentedControlProps<Value>) {
  return (
    <RadioGroup
      id={id}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled}
      aria-busy={ariaBusy}
      className={cn("grid h-10 w-full grid-cols-3 gap-0 rounded-lg bg-muted p-1", className)}
      onValueChange={(nextValue) => onValueChange(nextValue as Value)}
    >
      {items.map((item) => (
        <label key={item.value} className="min-w-0">
          <RadioGroupItem value={item.value} className="peer sr-only" />
          <span className={cn(
            "flex h-8 w-full cursor-default items-center justify-center rounded-md bg-transparent px-3 text-[13px] font-medium text-muted-foreground transition-[color,background-color,box-shadow] hover:bg-accent hover:text-accent-foreground peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:opacity-50",
            value === item.value && "bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground"
          )}>
            {item.label}
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}
