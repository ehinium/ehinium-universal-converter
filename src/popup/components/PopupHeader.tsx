import { Settings } from "lucide-react";
import { Button } from "../../components/ui/button";

type PopupHeaderProps = {
  enabled: boolean;
  onOpenSettings: () => void;
};

export function PopupHeader({ enabled, onOpenSettings }: PopupHeaderProps) {
  return (
    <header className="flex min-h-12 items-center gap-3">
      <img
        className="size-8 shrink-0"
        src="/icons/icon-128.png"
        alt=""
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold leading-5 text-foreground">
          Ehinium Universal Converter
        </h1>
        <p className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
          <span
            className={enabled ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-muted-foreground"}
            aria-hidden="true"
          />
          {enabled ? "Active" : "Inactive"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        aria-label="Open settings"
        title="Open settings"
        onClick={onOpenSettings}
      >
        <span>Settings</span>
        <Settings aria-hidden="true" />
      </Button>
    </header>
  );
}
