import { useTranslation } from "react-i18next";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLanguage } from "@/i18n/useLanguage";
import { isLanguage } from "@/i18n/language";
import { cn } from "@/lib/utils";

interface LanguageSwitchProps {
  className?: string;
}

export function LanguageSwitch({ className }: LanguageSwitchProps) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();

  return (
    <ToggleGroup
      type="single"
      value={language}
      onValueChange={(value: string) => {
        if (isLanguage(value)) setLanguage(value);
      }}
      aria-label={t("common.language.label")}
      className={cn("gap-1", className)}
    >
      <ToggleGroupItem
        value="nb"
        size="sm"
        aria-label={t("common.language.nb")}
        className="h-8 px-2 text-xs font-medium data-[state=on]:bg-accent/15 data-[state=on]:text-accent"
      >
        NB
      </ToggleGroupItem>
      <ToggleGroupItem
        value="en"
        size="sm"
        aria-label={t("common.language.en")}
        className="h-8 px-2 text-xs font-medium data-[state=on]:bg-accent/15 data-[state=on]:text-accent"
      >
        EN
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
