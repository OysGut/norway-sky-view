import { cn } from "@/lib/utils";

type ReadoutSize = "sm" | "md" | "lg";

interface ReadoutProps {
  label: string;
  value: string;
  unit?: string;
  size?: ReadoutSize;
}

const valueSizeClasses: Record<ReadoutSize, string> = {
  sm: "text-base font-medium",
  md: "text-2xl font-medium",
  lg: "font-serif text-[40px] leading-none",
};

export function Readout({ label, value, unit, size = "md" }: ReadoutProps) {
  return (
    <div className="min-w-0 transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("tabular mt-1 text-foreground", valueSizeClasses[size])}>
        {value}
        {unit ? (
          <span className="ml-1 font-sans text-[0.55em] text-muted-foreground">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}
