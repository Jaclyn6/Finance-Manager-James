"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";

interface Snapshot {
  date: string;
  replayScore: number | null;
  originalScore: number | null;
  delta: number | null;
}

interface Props {
  snapshots: ReadonlyArray<Snapshot>;
}

/**
 * Phase 3.4 Step 5 — dual-line backtest chart.
 *
 * Original (then) score plotted as a faded grey line; replay (now)
 * score plotted vivid. Tooltip shows both + delta. X-axis labels
 * thinned to ~8 dates.
 */
export function BacktestChart({ snapshots }: Props) {
  const chartData = snapshots.map((s) => ({
    date: s.date,
    "그때": s.originalScore,
    "지금": s.replayScore,
    delta: s.delta,
  }));

  return (
    <Card className="p-4 md:p-6">
      <CardContent className="p-0">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          점수 비교 — 그때(원본) vs 지금(재계산)
        </h2>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis
                dataKey="date"
                interval="preserveStartEnd"
                tick={{ fontSize: 11 }}
                minTickGap={30}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                }}
                formatter={(value: unknown) =>
                  typeof value === "number" ? value.toFixed(2) : "—"
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="그때"
                stroke="#9ca3af"
                strokeDasharray="4 2"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="지금"
                stroke="#7132f5"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
