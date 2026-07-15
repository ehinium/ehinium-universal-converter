import type { ExchangeRateStatus } from "../../services/rates";
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

  return (
    <div
      className={`rate-status${hasError ? " rate-status--error" : ""}`}
      aria-live="polite"
    >
      <span className="status-indicator" aria-hidden="true" />
      <span className="rate-status-copy">
        <span className="rate-status-message">{message}</span>
        {details.length > 0 ? (
          <span className="rate-status-detail">{details.join(" · ")}</span>
        ) : null}
      </span>
      <button
        className="button button--secondary"
        type="button"
        disabled={disabled || isRefreshing}
        aria-busy={isRefreshing}
        onClick={onRefresh}
      >
        {isRefreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
