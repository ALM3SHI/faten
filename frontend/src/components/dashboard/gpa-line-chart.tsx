"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

/** Cumulative vs term GPA line chart (loaded lazily by CumulativeGpaCard). */
export function GpaLineChart({
  series,
}: {
  series: { semester: string; cumulativeGpa: number; semesterGpa: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={series} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="gpaGlow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(245, 78%, 62%)" />
            <stop offset="100%" stopColor="hsl(187, 80%, 48%)" />
          </linearGradient>
          <filter id="gpaGlowFilter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="semester" hide />
        <YAxis domain={[0, 4]} hide />
        <Tooltip
          cursor={{
            stroke: "color-mix(in oklab, var(--foreground) 15%, transparent)",
            strokeWidth: 1,
          }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            backdropFilter: "blur(8px)",
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--popover-foreground)",
          }}
          labelStyle={{
            color: "var(--muted-text)",
            fontSize: 10,
            marginBottom: 4,
          }}
          formatter={(value, name) => {
            const num = typeof value === "number" ? value : Number(value);
            const label = name === "cumulativeGpa" ? "تراكمي" : "فصلي";
            return [Number.isFinite(num) ? num.toFixed(2) : String(value), label];
          }}
        />
        <Line
          type="monotone"
          dataKey="semesterGpa"
          stroke="color-mix(in oklab, var(--foreground) 35%, transparent)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          dot={false}
          activeDot={false}
        />
        <Line
          type="monotone"
          dataKey="cumulativeGpa"
          stroke="url(#gpaGlow)"
          strokeWidth={3}
          filter="url(#gpaGlowFilter)"
          dot={{ r: 4, fill: "hsl(245, 78%, 62%)", strokeWidth: 0 }}
          activeDot={{
            r: 6,
            fill: "var(--background)",
            stroke: "hsl(245, 78%, 62%)",
            strokeWidth: 2,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
