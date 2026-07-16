import { Field, FieldDescription, FieldLabel } from "../../components/ui/field";
import { Textarea } from "../../components/ui/textarea";

export type DomainListFieldProps = {
  id: string;
  label: string;
  count: number;
  value: string;
  disabled: boolean;
  placeholder: string;
  description: string;
  onChange: (value: string) => void;
};

export function DomainListField({
  id,
  label,
  count,
  value,
  disabled,
  placeholder,
  description,
  onChange,
}: DomainListFieldProps) {
  const descriptionId = `${id.replace(/-domains$/u, "")}-description`;

  return (
    <Field className="gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span className="text-xs text-muted-foreground">{count} - one per line</span>
      </div>
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        rows={4}
        spellCheck={false}
        placeholder={placeholder}
        aria-describedby={descriptionId}
        className="font-mono text-xs"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <FieldDescription id={descriptionId} className="text-[13px]">
        {description}
      </FieldDescription>
    </Field>
  );
}
