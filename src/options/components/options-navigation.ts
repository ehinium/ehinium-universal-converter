import type { LucideIcon } from "lucide-react";
import { CircleDollarSign, Globe2, Info, Palette, Ruler, SlidersHorizontal } from "lucide-react";

export type OptionsSectionId =
  | "general"
  | "currencies"
  | "units"
  | "website-rules"
  | "appearance"
  | "about";

export const navigationItems: Array<{
  id: OptionsSectionId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "currencies", label: "Currencies", icon: CircleDollarSign },
  { id: "units", label: "Units", icon: Ruler },
  { id: "website-rules", label: "Website rules", icon: Globe2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "about", label: "About", icon: Info },
];
