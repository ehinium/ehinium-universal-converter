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
    <label className="domain-field" htmlFor={id}>
      <span className="domain-label-row">
        <span className="setting-label">{label}</span>
        <span>{count} - one per line</span>
      </span>
      <textarea
        id={id}
        className="textarea-control"
        value={value}
        disabled={disabled}
        rows={3}
        spellCheck={false}
        placeholder={placeholder}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <span id={descriptionId} className="field-help">
        {description}
      </span>
    </label>
  );
}
