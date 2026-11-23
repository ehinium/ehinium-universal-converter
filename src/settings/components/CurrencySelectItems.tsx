import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Input } from "../../components/ui/input";
import { SelectItem } from "../../components/ui/select";

type Currency = { code: string; name: string };

// Radix moves focus to hovered items; keep it in the search box while the user is typing there.
function keepSearchFocus(event: PointerEvent<HTMLElement>) {
  if (document.activeElement instanceof HTMLInputElement) event.preventDefault();
}

/** Search box plus filtered items, rendered inside a SelectContent. */
export function CurrencySelectItems({ currencies }: { currencies: readonly Currency[] }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const matches = (currency: Currency) => `${currency.code} ${currency.name}`.toLowerCase().includes(needle);
  const matchCount = currencies.filter(matches).length;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    // Stop Radix typeahead; printable keys always go to the search box.
    event.stopPropagation();
    if (event.target === inputRef.current) return;
    event.preventDefault();
    setQuery((current) => current + event.key);
    inputRef.current?.focus();
  }

  return (
    <div onKeyDown={onKeyDown}>
      <div className="sticky top-0 z-10 bg-popover p-1">
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search currencies"
          aria-label="Search currencies"
          autoComplete="off"
          className="h-8"
        />
      </div>
      {/* Hide rather than unmount: Radix steals focus back when the selected item unmounts. */}
      {currencies.map((currency) => (
        <SelectItem
          key={currency.code}
          value={currency.code}
          hidden={!matches(currency)}
          disabled={!matches(currency)}
          onPointerMove={keepSearchFocus}
          onPointerLeave={keepSearchFocus}
          className="hover:bg-accent hover:text-accent-foreground"
        >
          {currency.code} - {currency.name}
        </SelectItem>
      ))}
      {matchCount === 0 && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">No currencies found</p>
      )}
    </div>
  );
}
