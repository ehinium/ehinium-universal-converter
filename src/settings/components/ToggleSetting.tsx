export type ToggleSettingProps = {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export function ToggleSetting({
  id,
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: ToggleSettingProps) {
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <label className={`toggle-setting${disabled ? " toggle-setting--disabled" : ""}`}>
      <span className="setting-copy">
        <span className="setting-label" id={labelId}>
          {label}
        </span>
        <span className="setting-description" id={descriptionId}>
          {description}
        </span>
      </span>
      <span className="toggle-slot">
        <input
          id={id}
          className="toggle-input"
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="toggle-control" aria-hidden="true">
          <span className="toggle-knob" />
        </span>
      </span>
    </label>
  );
}
