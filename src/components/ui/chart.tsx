"use client";

import {
  createContext,
  useContext,
  useId,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "../../lib/utils";

/**
 * Versi ringkas chart shadcn: ChartConfig mendeklarasikan label + warna per seri; warna disuntik
 * sebagai CSS var `--color-<key>` pada kontainer sehingga seri Recharts memakai token scope admin.
 */
export type ChartConfig = Record<string, { label?: string; color?: string }>;

const ChartContext = createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = useContext(ChartContext);
  if (!context)
    throw new Error("useChart harus dipakai di dalam <ChartContainer />");
  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: ComponentProps<"div"> & { config: ChartConfig; children: ReactNode }) {
  const uniqueId = useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  const style = Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => value.color)
      .map(([key, value]) => [`--color-${key}`, value.color]),
  ) as CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        style={style}
        className={cn(
          "flex min-h-0 w-full justify-center text-caption [&_.recharts-responsive-container]:min-h-0 [&_.recharts-cartesian-axis-tick-value]:fill-[var(--ad-muted)] [&_.recharts-cartesian-grid_line]:stroke-[var(--ad-border)] [&_.recharts-tooltip-cursor]:stroke-[var(--ad-border)]",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

interface TooltipItem {
  dataKey?: string | number;
  name?: string;
  value?: number | string;
  color?: string;
}

/** Isi tooltip: label sumbu + baris per seri (swatch warna, label, nilai mono). */
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  className,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string;
  labelFormatter?: (label: string) => string;
  className?: string;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  return (
    <div
      className={cn(
        "grid min-w-[8rem] gap-1.5 rounded-md border border-[var(--ad-border)] bg-[var(--ad-surface)] px-2.5 py-1.5 text-caption shadow-overlay",
        className,
      )}
    >
      {label !== undefined && (
        <div className="font-bold text-[color:var(--ad-text)]">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? item.name ?? index);
        return (
          <div key={key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: item.color ?? `var(--color-${key})` }}
            />
            <span className="text-[color:var(--ad-muted)]">
              {config[key]?.label ?? item.name ?? key}
            </span>
            <span className="ml-auto font-mono font-bold text-[color:var(--ad-text)]">
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const ChartLegend = RechartsPrimitive.Legend;

/** Legenda: swatch + label per seri, di bawah grafik. */
export function ChartLegendContent({
  payload,
  className,
}: {
  payload?: TooltipItem[];
  className?: string;
}) {
  const { config } = useChart();
  if (!payload?.length) return null;
  return (
    <div
      className={cn("flex items-center justify-center gap-4 pt-3", className)}
    >
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? index);
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: item.color ?? `var(--color-${key})` }}
            />
            <span className="text-caption text-[color:var(--ad-muted)]">
              {config[key]?.label ?? item.name ?? key}
            </span>
          </div>
        );
      })}
    </div>
  );
}
