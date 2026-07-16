export function OptionsHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-[1120px] items-center gap-2.5 px-6 py-3 sm:px-8">
        <img
          className="size-9 shrink-0"
          src="/icons/icon-128.png"
          alt=""
          aria-hidden="true"
        />
        <div className="grid min-w-0 gap-0.5">
          <p className="text-xs font-medium leading-4 text-muted-foreground">Ehinium Universal Converter</p>
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-foreground">Settings</h1>
        </div>
      </div>
    </header>
  );
}
