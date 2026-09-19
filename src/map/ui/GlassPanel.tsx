import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type GlassPanelPadding = "none" | "sm" | "md" | "lg";

interface GlassPanelProps {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  padding?: GlassPanelPadding;
}

const paddingClasses: Record<GlassPanelPadding, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-5",
  lg: "p-8",
};

export function GlassPanel({
  as: Component = "div",
  children,
  className,
  padding = "md",
}: GlassPanelProps) {
  return (
    <Component
      className={cn(
        "glass-panel transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
        paddingClasses[padding],
        className,
      )}
    >
      {children}
    </Component>
  );
}