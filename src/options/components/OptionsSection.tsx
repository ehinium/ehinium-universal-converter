import type { ReactNode } from "react";

type OptionsSectionProps = {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function OptionsSection({
  id,
  title,
  description,
  children,
}: OptionsSectionProps) {
  const titleId = `${id}-title`;

  return (
    <section id={id} aria-labelledby={titleId} tabIndex={-1} className="grid scroll-mt-6 gap-5 outline-none">
      <div>
        <h2 id={titleId} className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}
