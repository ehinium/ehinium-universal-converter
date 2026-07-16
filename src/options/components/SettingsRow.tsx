import type { ReactNode } from "react";
import { Label } from "../../components/ui/label";
import { settingsControlWidths } from "./settings-control-widths";

type SettingsRowProps = {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
  controlClassName?: string;
};

export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  controlClassName = settingsControlWidths.standard,
}: SettingsRowProps) {
  return (
    <div className="flex min-h-14 flex-col items-stretch justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1 space-y-1">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm leading-5 font-medium">{label}</Label>
        ) : (
          <p className="text-sm leading-5 font-medium">{label}</p>
        )}
        {description ? (
          <p id={htmlFor ? `${htmlFor}-description` : undefined} className="text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className={`min-w-0 shrink-0 self-center ${controlClassName}`}>{children}</div>
    </div>
  );
}
