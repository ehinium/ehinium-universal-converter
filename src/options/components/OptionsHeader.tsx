export function OptionsHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-[1120px] items-center gap-3 px-6 py-4 sm:px-8">
        <img
          className="size-10 shrink-0"
          src="/icons/icon-128.png"
          alt=""
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-4 text-muted-foreground">Ehinium Universal Converter</p>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Configure conversions, website rules, and appearance.
          </p>
        </div>
      </div>
    </header>
  );
}
