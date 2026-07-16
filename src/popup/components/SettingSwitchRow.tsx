import type { ComponentPropsWithoutRef } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../components/ui/field";
import { Switch } from "../../components/ui/switch";

type SettingSwitchRowProps = {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  switchProps?: Omit<ComponentPropsWithoutRef<typeof Switch>, "id" | "checked" | "disabled" | "onCheckedChange">;
};

export function SettingSwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
  switchProps,
}: SettingSwitchRowProps) {
  const descriptionId = `${id}-description`;

  return (
    <Field orientation="horizontal" className="min-h-10 gap-4" data-disabled={disabled}>
      <FieldContent className="min-w-0 gap-1">
        <FieldLabel htmlFor={id}>
          {label}
        </FieldLabel>
        <FieldDescription id={descriptionId} className="text-xs">
          {description}
        </FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onCheckedChange={onCheckedChange}
        {...switchProps}
      />
    </Field>
  );
}
