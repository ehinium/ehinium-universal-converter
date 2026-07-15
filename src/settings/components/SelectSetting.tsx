import type { ChangeEventHandler, ReactNode } from "react";

export type SelectSettingProps = {
  id: string;
  label: string;
  description?: string;
  value: string;
  disabled?: boolean;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
};

export function SelectSetting({
  id,
  label,
  description,
  value,
  disabled = false,
  onChange,
  children,
}: SelectSettingProps) {
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={`setting-row${disabled ? " setting-row--disabled" : ""}`}>
      <div className="setting-copy">
        <label className="setting-label" htmlFor={id}>
          {label}
        </label>
        {description ? <p id={descriptionId}>{description}</p> : null}
      </div>
      <div className="setting-control">
        <select
          id={id}
          className="select-control"
          value={value}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={onChange}
        >
          {children}
        </select>
      </div>
    </div>
  );
}
