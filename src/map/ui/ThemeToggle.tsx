import { IconMoon, IconSun } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? t("design.theme.light") : t("design.theme.dark");

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn(
        "glass-panel transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
        className,
      )}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {isDark ? <IconSun aria-hidden="true" stroke={1.5} /> : <IconMoon aria-hidden="true" stroke={1.5} />}
    </Button>
  );
}