import type { RefObject } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field, FieldDescription, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import type { ManualConversionResult } from "../../services/selectedTextConverter";
import type { ManualFeedback } from "../../settings/manualFeedback";
import { cn } from "../../lib/utils";

type ManualConversionPanelProps = {
  disabled: boolean;
  input: string;
  result: ManualConversionResult | null;
  feedback: ManualFeedback | null;
  isConverting: boolean;
  copyLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputChange: (value: string) => void;
  onBlur: (value: string) => void;
  onPaste: () => void;
  onCopy: () => void;
};

export function ManualConversionPanel({
  disabled,
  input,
  result,
  feedback,
  isConverting,
  copyLabel,
  inputRef,
  onInputChange,
  onBlur,
  onPaste,
  onCopy,
}: ManualConversionPanelProps) {
  return (
    <section aria-labelledby="manual-conversion-title">
      <Field className="gap-3">
        <div className="grid gap-1">
          <h2>
            <FieldLabel id="manual-conversion-title" htmlFor="manual-conversion-input" className="text-[13px] leading-5">
              Manual conversion
            </FieldLabel>
          </h2>
          <FieldDescription className="text-xs leading-4">
            Convert one value without visiting a page.
          </FieldDescription>
        </div>
        <Input
          ref={inputRef}
          id="manual-conversion-input"
          value={input}
          disabled={disabled}
          aria-invalid={Boolean(feedback?.invalid)}
          aria-describedby="manual-conversion-state"
          placeholder="Enter 100 EUR or 180 cm"
          onChange={(event) => onInputChange(event.target.value)}
          onBlur={(event) => onBlur(event.target.value)}
          onPaste={onPaste}
        />
        <div id="manual-conversion-state" aria-live="polite">
        {disabled ? (
          <p className="text-xs leading-4 text-muted-foreground">
            Enable conversions to use this tool.
          </p>
        ) : isConverting ? (
          <p className="text-xs leading-4 text-muted-foreground">Converting…</p>
        ) : result ? (
          <Card className="flex items-center gap-3 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="manual-source truncate text-xs leading-4 text-muted-foreground">
                  {result.source}
                </p>
                <output
                  className="manual-converted block truncate text-sm font-semibold leading-5 text-foreground"
                  htmlFor="manual-conversion-input"
                >
                  {result.converted}
                </output>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onCopy}>
                {copyLabel === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copyLabel}
              </Button>
          </Card>
        ) : feedback ? (
          <p
            className={cn(
              "text-xs leading-4 text-muted-foreground",
              feedback.tone === "error" && "text-destructive"
            )}
          >
            {feedback.message}
          </p>
        ) : null}
        </div>
      </Field>
    </section>
  );
}
