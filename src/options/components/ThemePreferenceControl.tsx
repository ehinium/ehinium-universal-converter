import { useState } from "react";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useTheme } from "../../components/theme-context";
import type { ThemePreference } from "../../types/theme";

const preferences: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemePreferenceControl() {
  const { preference, setThemePreference } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectPreference(nextPreference: ThemePreference): Promise<void> {
    if (isSaving) return;
    setError(null);
    setIsSaving(true);
    const saved = await setThemePreference(nextPreference);
    if (!saved) setError("Unable to save theme preference.");
    setIsSaving(false);
  }

  return (
    <div className="grid gap-1.5">
      <SegmentedControl
        items={preferences}
        value={preference}
        disabled={isSaving}
        ariaLabel="Theme preference"
        ariaBusy={isSaving}
        onValueChange={(nextPreference) => void selectPreference(nextPreference)}
      />
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
