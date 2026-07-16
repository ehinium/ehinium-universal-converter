import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { navigationItems, type OptionsSectionId } from "./options-navigation";

type OptionsNavigationProps = {
  activeSection: OptionsSectionId;
  onSectionSelect: (section: OptionsSectionId) => void;
};

export function OptionsNavigation({
  activeSection,
  onSectionSelect,
}: OptionsNavigationProps) {
  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-6 lg:self-start">
      <div className="flex flex-wrap gap-1 lg:grid">
        {navigationItems.map(({ id, label, icon: Icon }) => {
          const selected = activeSection === id;
          return (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="sm"
              aria-current={selected ? "page" : undefined}
              aria-controls={id}
              className={cn(
                "h-9 justify-start rounded-md px-2.5 text-sm text-muted-foreground",
                selected && "bg-secondary text-secondary-foreground hover:bg-secondary"
              )}
              onClick={() => onSectionSelect(id)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
