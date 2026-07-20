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

function getIranianStatusLines(
  status: NonNullable<CombinedRateStatus["iranianBridgeStatus"]>
): [string, string?] {
  if (status.state === "fresh" || status.state === "stale") {
    const [, freshDetails = ""] = formatIranianBridgeStatus({
      ...status,
      state: "fresh",
    });
    const updated = freshDetails.split(" · ").at(-1) ?? "Updated time unavailable";
    return [updated, status.state === "stale" ? "Cached Ehinium source" : "Ehinium source"];
  }

  if (status.state === "loading") return ["Loading Iranian rate..."];
  if (status.state === "unavailable") return ["Iranian rate unavailable"];
  if (status.state === "misconfigured") return ["Iranian rate configuration unavailable"];
  return [""];
}

export function RateStatus({
  status,
  isRefreshing,
  disabled,
  onRefresh,
}: RateStatusProps) {
  const [message, ...details] = formatRateStatus(status);
  const hasError = status.lastErrorAt !== null;
  const hasRates = status.response !== null;
  const iranianStatus = status.iranianBridgeStatus;
  const [iranianMessage, iranianDetail] = iranianStatus
    ? getIranianStatusLines(iranianStatus)
    : [""];

  return (
    <div className="rate-status flex flex-wrap items-center gap-2" aria-live="polite">
      <span className="grid min-w-0 flex-1 gap-2">
        <span className="flex min-w-0 items-start gap-2" aria-label="Exchange rate status">
          <span
            className={cn(
              "mt-1 size-2 shrink-0 rounded-full bg-muted-foreground",
              hasRates && "bg-success",
              hasError && "bg-destructive"
            )}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className={cn("block text-[13px] font-medium leading-4 text-foreground", hasError && "text-destructive")}>{message}</span>
            {details.length > 0 ? (
              <span className="block text-xs leading-4 text-muted-foreground">{details.join(" · ")}</span>
            ) : null}
          </span>
        </span>
        {iranianMessage ? (
          <span className="flex min-w-0 items-start gap-2" aria-label="Iranian rate status">
            <span
              className={cn(
                "mt-1 size-2 shrink-0 rounded-full bg-muted-foreground",
                (iranianStatus?.state === "fresh" || iranianStatus?.state === "stale") && "bg-success",
                (iranianStatus?.state === "unavailable" || iranianStatus?.state === "misconfigured") && "bg-destructive"
              )}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-4 text-foreground">{iranianMessage}</span>
              {iranianDetail ? (
                <span className="block text-xs leading-4 text-muted-foreground">{iranianDetail}</span>
              ) : null}
            </span>
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
