/**
 * 通用 UI 原语（响应式、维护简单，不依赖重型 UI 库）
 */
import { type ReactNode, useEffect } from 'react';

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={'card ' + (className || '')}>
      {(title || actions) && (
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>;
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  percent?: boolean;   // 显示为 %；输入 0-100
  frac?: boolean;      // 显示为 0-1 小数（穿透百分比）
  decimals?: number;
}
/** 数字输入框（必要时带 + / - 快捷按钮） */
export function NumberField({ label, value, onChange, step = 1, min, max, percent, frac, decimals = 2 }: NumberFieldProps) {
  const raw = Number.isFinite(value) ? value : 0;
  const display = percent ? String(raw) : frac ? String(raw) : String(raw);
  const commit = (s: string) => {
    const n = parseFloat(s);
    if (Number.isNaN(n)) return;
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    onChange(Math.round(v * 100) / 100);
  };
  const suffix = percent ? '%' : frac ? '' : '';
  return (
    <label className="field">
      <span>{label}{percent || frac ? suffix : ''}</span>
      <div className="row" style={{ gap: 4 }}>
        <button type="button" className="btn sm" style={{ padding: '5px 7px' }} onClick={() => commit(String(raw - step))} aria-label="减">−</button>
        <input
          className="no"
          type="number"
          step={step}
          value={display}
          onChange={(e) => commit(e.target.value)}
          min={min}
          max={max}
        />
        <button type="button" className="btn sm" style={{ padding: '5px 7px' }} onClick={() => commit(String(raw + step))} aria-label="加">+</button>
      </div>
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 'auto', flex: '0 0 auto' }}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn ghost" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 统计格子 */
export function StatBox({ k, v, small, tone }: { k: string; v: ReactNode; small?: boolean; tone?: 'good' | 'bad' | 'brand' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : tone === 'brand' ? 'var(--brand)' : undefined;
  return (
    <div className="stat-box">
      <div className="k">{k}</div>
      <div className={'v' + (small ? ' small' : '')} style={color ? { color } : undefined}>{v}</div>
    </div>
  );
}

export const num = (n: number, d = 2) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : '0');
export const pct = (n: number, d = 1) => `${Number.isFinite(n) ? n.toFixed(d) : '0'}%`;
export const fmtTime = (ms: number) => {
  if (!Number.isFinite(ms)) return '0.000s';
  const s = ms / 1000;
  return `${s.toFixed(3)}s`;
};