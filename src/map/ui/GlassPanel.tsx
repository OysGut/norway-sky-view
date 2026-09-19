import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type GlassPanelPadding = "none" | "sm" | "md" | "lg";

// Restricted to HTML tags: once @react-three/fiber's JSX types are in the
// project, a bare `ElementType` collapses the props to `never`.
type GlassPanelTag = "div" | "section" | "aside" | "header" | "footer" | "nav" | "form";

interface GlassPanelProps {
  as?: GlassPanelTag;
  children: ReactNode;
  className?: string | undefined;
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
