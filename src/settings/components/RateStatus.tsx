import { RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import {
  formatIranianBridgeStatus,
  formatRateStatus,
  type CombinedRateStatus,
} from "../../popup/rateStatus";

export type RateStatusProps = {
  status: CombinedRateStatus;
  isRefreshing: boolean;
  disabled: boolean;
  onRefresh: () => void;
};

export function RateStatus({
  status,
  isRefreshing,
  disabled,
  onRefresh,
}: RateStatusProps) {
  const [message, ...details] = formatRateStatus(status);
  const hasError = status.lastErrorAt !== null;
  const hasRates = status.response !== null;
  const [iranianMessage, ...iranianDetails] = status.iranianBridgeStatus
    ? formatIranianBridgeStatus(status.iranianBridgeStatus)
    : [];

  return (
    <div className="rate-status flex flex-wrap items-center gap-2" aria-live="polite">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full bg-muted-foreground",
          hasRates && "bg-success",
          hasError && "bg-destructive"
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px] font-medium leading-4 text-foreground", hasError && "text-destructive")}>{message}</span>
        {details.length > 0 ? (
          <span className="block text-xs leading-4 text-muted-foreground">{details.join(" · ")}</span>
        ) : null}
        {iranianMessage ? (
          <span className="mt-1 block text-xs leading-4 text-muted-foreground">
            <span className="font-medium text-foreground">{iranianMessage}</span>
            {iranianDetails.length > 0 ? ` · ${iranianDetails.join(" · ")}` : ""}
          </span>
        ) : null}
      </span>
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={disabled || isRefreshing}
        aria-busy={isRefreshing}
        onClick={onRefresh}
      >
        <RefreshCw className={isRefreshing ? "animate-spin" : undefined} aria-hidden="true" />
        {isRefreshing ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}
