import type { ReactNode } from "react";

export type SettingsSectionProps = {
  id: string;
  title: string;
  description?: string;
  disabled?: boolean;
  children: ReactNode;
};

export function SettingsSection({
  id,
  title,
  description,
  disabled = false,
  children,
}: SettingsSectionProps) {
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <section
      className={`settings-section${disabled ? " settings-section--disabled" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-disabled={disabled || undefined}
    >
      <div className="section-heading">
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}
      </div>
      <div className="section-content">{children}</div>
    </section>
  );
}
