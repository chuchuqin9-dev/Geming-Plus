/**
 * 方案对比：选取两个已保存模拟结果，左右对比伤害/承伤/生存指标与差值
 */
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card, num, pct } from '../components/ui';
import type { CombatantResult } from '../core/types';

interface Row {
  key: string;
  label: string;
  pick: (r: CombatantResult) => number;
}

const ROWS: Row[] = [
  { key: 'total', label: '总伤害', pick: (r) => r.damage.total },
  { key: 'dps', label: '全程 DPS', pick: (r) => r.damage.total / Math.max(r.survivedMs / 1000, 0.001) },
  { key: 'phys', label: '物理伤害', pick: (r) => r.damage.physical },
  { key: 'magic', label: '魔法伤害', pick: (r) => r.damage.magic },
  { key: 'trueDmg', label: '真实伤害', pick: (r) => r.damage.trueDmg },
  { key: 'crit', label: '暴击次数', pick: (r) => r.damage.critCount },
  { key: 'taken', label: '总承伤', pick: (r) => r.defense.damageTaken },
  { key: 'heal', label: '总治疗', pick: (r) => r.lifesteal.totalHealing },
  { key: 'shield', label: '护盾吸收', pick: (r) => r.defense.shieldAbsorbed },
  { key: 'survive', label: '存活时间(s)', pick: (r) => r.survivedMs / 1000 },
];

export function Compare() {
  const { savedSimulations } = useAppStore();
  const [aId, setAId] = useState<string>('');
  const [bId, setBId] = useState<string>('');
  const sorted = useMemo(() => [...savedSimulations].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1)), [savedSimulations]);

  const simA = sorted.find((x) => x.id === aId);
  const simB = sorted.find((x) => x.id === bId);
  const ra = simA?.result.results.find((x) => x.isHero);
  const rb = simB?.result.results.find((x) => x.isHero);

  return (
    <div style={{ maxWidth: 860 }}>
      <Card title="方案对比">
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field"><span>方案 A</span>
            <select value={aId} onChange={(e) => setAId(e.target.value)}>
              <option value="">选择历史方案</option>
              {sorted.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="field"><span>方案 B</span>
            <select value={bId} onChange={(e) => setBId(e.target.value)}>
              <option value="">选择历史方案</option>
              {sorted.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        </div>
        {!ra || !rb ? <p className="muted">请分别选择两个已保存的方案进行对比。</p> : (
          <table>
            <thead>
              <tr><th>指标</th><th className="num">方案 A</th><th className="num">方案 B</th><th className="num">差值</th><th className="num">差值%</th></tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const va = row.pick(ra); const vb = row.pick(rb);
                const diff = vb - va;
                const rel = va !== 0 ? (diff / Math.abs(va)) * 100 : 0;
                const better = (row.key === 'taken' ? diff < 0 : diff > 0);
                return (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td className="num">{num(va)}</td>
                    <td className="num">{num(vb)}</td>
                    <td className="num" style={{ color: diff === 0 ? undefined : better ? 'var(--good)' : 'var(--bad)' }}>{diff > 0 ? '+' : ''}{num(diff)}</td>
                    <td className="num" style={{ color: diff === 0 ? undefined : better ? 'var(--good)' : 'var(--bad)' }}>{rel > 0 ? '+' : ''}{pct(rel)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}