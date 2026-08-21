/**
 * 轻量 SVG 图表（零依赖，适合批量渲染）
 */

export interface Pt { x: number; y: number }

interface LineChartProps {
  title?: string;
  series: Array<{ name: string; color: string; points: Pt[] }>;
  width?: number; height?: number;
  xLabel?: string; yLabel?: string;
}

/** 单一坐标轴折线图（DPS 曲线 / 生命值曲线） */
export function LineChart({ title, series, width = 640, height = 240, xLabel, yLabel }: LineChartProps) {
  const pad = { l: 44, r: 12, t: 18, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const allPts = series.flatMap((s) => s.points);
  const maxX = Math.max(1, ...allPts.map((p) => p.x));
  const maxY = Math.max(1, ...allPts.map((p) => p.y)) * 1.05;
  const sx = (x: number) => pad.l + (x / maxX) * iw;
  const sy = (y: number) => pad.t + ih - (y / maxY) * ih;

  const path = (pts: Pt[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  const ticks = 5;
  const gridX = Array.from({ length: ticks + 1 }).map((_, i) => i * (iw / ticks));
  const gridY = Array.from({ length: ticks + 1 }).map((_, i) => i * (ih / ticks));

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
      {title && <text x={pad.l} y={14} fontSize={12} fill="currentColor" opacity={0.8}>{title}</text>}
      {gridY.map((gy, i) => (
        <g key={i}>
          <line x1={pad.l} y1={pad.t + gy} x2={width - pad.r} y2={pad.t + gy} stroke="currentColor" opacity={0.08} />
          <text x={pad.l - 4} y={pad.t + gy + 3} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.5}>
            {Math.round(maxY - (i / ticks) * maxY)}
          </text>
        </g>
      ))}
      {gridX.map((gx, i) => (
        <text key={i} x={pad.l + gx} y={height - 8} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.5}>
          {(i / ticks) * maxX >= 1000 ? `${((i / ticks) * maxX) / 1000}K` : Math.round((i / ticks) * maxX)}
        </text>
      ))}
      {series.map((s, i) => (
        <path key={i} d={path(s.points) || ''} fill="none" stroke={s.color} strokeWidth={2} />
      ))}
      {xLabel && <text x={width / 2} y={height - 2} fontSize={11} textAnchor="middle" fill="currentColor" opacity={0.6}>{xLabel}</text>}
      {yLabel && <text x={14} y={height / 2} fontSize={11} textAnchor="middle" fill="currentColor" opacity={0.6} transform={`rotate(-90 14 ${height / 2})`}>{yLabel}</text>}
      {
        series.length > 0 && (
          <g>
            {series.map((s, i) => (
              <g key={'lg' + i} transform={`translate(${width - pad.r - 8},${pad.t + 4 + i * 16})`}>
                <rect x={-12} width={10} height={10} rx={2} fill={s.color} />
                <text x={0} y={9} fontSize={11} fill="currentColor" opacity={0.8}>{s.name}</text>
              </g>
            ))}
          </g>
        )
      }
    </svg>
  );
}

/** 横向占比条（伤害构成 / 类型构成） */
export function ShareBars({ items }: { items: Array<{ label: string; value: number; percent: number; color: string }> }) {
  const total = 100;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="bar">{items.map((it) => <span key={it.label} style={{ width: `${(it.percent / total) * 100}%`, background: it.color }} />)}</div>
      {items.map((it) => (
        <div key={it.label} className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, display: 'inline-block', background: it.color }} />{it.label}</span>
          <span className="mono">{it.value.toLocaleString()} · {it.percent.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}