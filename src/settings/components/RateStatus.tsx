import { RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { ExchangeRateStatus } from "../../services/rates";
import { cn } from "../../lib/utils";
import { formatRateStatus } from "../../popup/rateStatus";

export type RateStatusProps = {
  status: ExchangeRateStatus;
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
