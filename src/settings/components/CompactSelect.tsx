import type { SelectSettingProps } from "./SelectSetting";

export type CompactSelectProps = Omit<SelectSettingProps, "description">;

export function CompactSelect({
  id,
  label,
  value,
  disabled = false,
  onChange,
  children,
}: CompactSelectProps) {
  return (
    <label className="compact-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        className="select-control"
        value={value}
        disabled={disabled}
        onChange={onChange}
      >
        {children}
      </select>
    </label>
  );
}
