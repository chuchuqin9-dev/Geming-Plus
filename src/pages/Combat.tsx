/**
 * 战斗模拟：三栏配置（英雄A / 战斗设置 / 英雄B或木桩）+ 结果展示
 */
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { buildCombatConfig } from '../core/combatConfig';
import { Card, NumberField, SelectField, StatBox, ToggleField, num, pct, fmtTime } from '../components/ui';
import { LineChart, ShareBars } from '../components/charts';
import { damageShare, damageTypeShare, dpsUpTo, avgDps } from '../core/stats';
import type { CombatConfig, CombatantId, CombatResult, Hero } from '../core/types';
import { MAX_EQUIPMENT } from '../core/types';

export function Combat() {
  const { heroes, equipment, result, running, setCombatConfig, runSimulation, saveSimulation, clearResult } = useAppStore();

  const [mode, setMode] = useState<'dummy' | 'vs'>('dummy');
  const [duration, setDuration] = useState(30);
  const [randomMode, setRandomMode] = useState<'seeded' | 'expectation'>('seeded');
  const [seed, setSeed] = useState(12345);
  const [heroAId, setHeroAId] = useState<string>('');
  const [itemsA, setItemsA] = useState<string[]>([]);
  const [heroBId, setHeroBId] = useState<string>('');
  const [itemsB, setItemsB] = useState<string[]>([]);
  const [dummy, setDummy] = useState({ infiniteHp: true, maxHp: 10000, armor: 30, magicResist: 30, damageReduction: 0 });

  const heroA = useMemo(() => heroes.find((x) => x.id === heroAId) ?? null, [heroes, heroAId]);
  const heroB = useMemo(() => heroes.find((x) => x.id === heroBId) ?? null, [heroes, heroBId]);

  const run = () => {
    if (!heroA) return;
    const config = buildCombatConfig({
      mode,
      durationSeconds: duration,
      randomMode,
      seed,
      heroA,
      itemsA,
      labelA: heroA.name,
      heroB: mode === 'vs' ? heroB ?? undefined : undefined,
      itemsB,
      labelB: heroB?.name,
      dummy,
      skillPriorityA: heroA.skills.map((s) => s.id),
      skillPriorityB: heroB?.skills.map((s) => s.id),
    });
    setCombatConfig(config);
    runSimulation();
  };

  const onSaveResult = () => { if (result) saveSimulation(result); };

  return (
    <div>
      <div className="combat-cols">
        <Card title="英雄 A">
          <HeroSetupPanel label="英雄 A" heroes={heroes} equipment={equipment} heroId={heroAId} onHeroId={setHeroAId} items={itemsA} onItems={setItemsA} />
        </Card>

        <Card title="战斗设置">
          <div className="grid grid-1" style={{ display: 'grid', gap: 10 }}>
            <SelectField label="模拟模式" value={mode} options={[{ value: 'dummy', label: '打木桩' }, { value: 'vs', label: '英雄 VS 英雄' }]} onChange={(v) => setMode(v as 'dummy' | 'vs')} />
            <SelectField label="时长" value={String(duration)} options={[5, 10, 15, 30, 60, 120].map((d) => ({ value: String(d), label: `${d} 秒` }))} onChange={(v) => setDuration(Number(v))} />
            <SelectField label="随机模式" value={randomMode} options={[{ value: 'seeded', label: '随机（Seed 可复现）' }, { value: 'expectation', label: '期望值（不抽样）' }]} onChange={(v) => setRandomMode(v as 'seeded' | 'expectation')} />
            {randomMode === 'seeded' && <NumberField label="随机种子" value={seed} step={1} onChange={setSeed} />}
            <button className="btn primary block" onClick={run} disabled={running || !heroA}>
              {running ? '模拟中…' : '开始模拟'}
            </button>
          </div>
        </Card>

        <Card title={mode === 'dummy' ? '木桩' : '英雄 B'}>
          {mode === 'dummy' ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="grid grid-2">
                <NumberField label="木桩生命" value={dummy.maxHp} step={1000} min={1} onChange={(v) => setDummy({ ...dummy, maxHp: v })} />
                <NumberField label="护甲" value={dummy.armor} step={10} min={0} onChange={(v) => setDummy({ ...dummy, armor: v })} />
                <NumberField label="魔抗" value={dummy.magicResist} step={10} min={0} onChange={(v) => setDummy({ ...dummy, magicResist: v })} />
                <ToggleField label="无限生命" checked={dummy.infiniteHp} onChange={(v) => setDummy({ ...dummy, infiniteHp: v })} />
              </div>
            </div>
          ) : (
            <HeroSetupPanel label="英雄 B" heroes={heroes} equipment={equipment} heroId={heroBId} onHeroId={setHeroBId} items={itemsB} onItems={setItemsB} />
          )}
        </Card>
      </div>

      {result && <ResultView result={result} onSave={onSaveResult} onClear={clearResult} />}
    </div>
  );
}

function HeroSetupPanel({ label, heroes, equipment, heroId, onHeroId, items, onItems }: {
  label?: string; heroes: Hero[]; equipment: { id: string; name: string }[]; heroId: string;
  onHeroId: (id: string) => void; items: string[]; onItems: (ids: string[]) => void; compact?: boolean;
}) {
  const setSlot = (i: number, id: string) => {
    const next = [...items]; next[i] = id;
    onItems(next.filter(Boolean).slice(0, MAX_EQUIPMENT));
  };
  return (
    <div>
      <label className="field"><span>选择英雄</span>
        <select value={heroId} onChange={(e) => onHeroId(e.target.value)}>
          <option value="">—— 请选择 ——</option>
          {heroes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>

      {heroId && (
        <>
          <div className="section-label">装备槽（最多 {MAX_EQUIPMENT}）</div>
          <div className="equip-slots" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
            {Array.from({ length: MAX_EQUIPMENT }).map((_, i) => {
              const sel = items[i];
              return (
                <div key={i} style={{ flex: '0 0 104px', border: '1px dashed var(--border)', borderRadius: 8, padding: 5 }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{i + 1}</div>
                  <select
                    value={sel ?? ''}
                    onChange={(e) => setSlot(i, e.target.value)}
                    style={{ fontSize: 12, padding: '4px 5px' }}
                  >
                    <option value="">（空）</option>
                    {equipment.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </>
      )}
      {!heroId && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>未选择英雄。</p>}
    </div>
  );
}

function ResultView({ result, onSave, onClear }: { result: CombatResult; onSave: () => void; onClear: () => void }) {
  const heros = result.results.filter((r) => r.isHero);
  const primary = heros[0];
  return (
    <>
      <Card title="结果概览" actions={<span className="muted">{result.endReason === 'victory' ? '胜利' : result.endReason === 'all_dead' ? '全灭' : '超时'} · {result.durationMs >= 1000 ? (result.durationMs / 1000).toFixed(1) : '0.0'}s</span>}>
        <div style={{ display: 'grid', gap: 14 }}>
          {heros.map((r) => (
            <div key={r.id}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <b>{r.label}</b>
                <span className="muted">最终生命 {r.finalHp.toLocaleString()} / {r.maxHp.toLocaleString()} · DPS {num(avgDps(result, r.id as CombatantId))}</span>
              </div>
              <div className="stat-grid">
                <StatBox k="总伤害" v={num(r.damage.total)} />
                <StatBox k="物理" v={num(r.damage.physical)} tone="brand" />
                <StatBox k="魔法" v={num(r.damage.magic)} tone="brand" />
                <StatBox k="真实" v={num(r.damage.trueDmg)} tone="brand" />
                <StatBox k="普攻" v={num(r.damage.basicAttack)} />
                <StatBox k="技能" v={num(r.damage.skill)} />
                <StatBox k="装备" v={num(r.damage.item)} />
                <StatBox k="暴击次数" v={r.damage.critCount} />
                <StatBox k="最大单次" v={num(maxHit(result, r.id as CombatantId))} />
                <StatBox k="总承伤" v={num(r.defense.damageTaken)} tone="bad" />
                <StatBox k="总治疗" v={num(r.lifesteal.totalHealing)} tone="good" />
                <StatBox k="护盾吸收" v={num(r.defense.shieldAbsorbed)} tone="brand" />
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={onSave}>保存到历史</button>
          <button className="btn" onClick={onClear}>清除结果</button>
        </div>
      </Card>

      {/* 曲线 */}
      <Card title="DPS 时间曲线">
        <LineChart
          title="累计伤害"
          series={heros.map((r) => ({
            name: r.label,
            color: r.id === 'A' ? 'var(--brand)' : 'var(--bad)',
            points: result.damageCurve.filter((p) => p.sourceId === r.id).map((p) => ({ x: p.tMs / 1000, y: p.cumulativeDamage })),
          }))}
          xLabel="秒" yLabel="累计伤害"
        />
        <LineChart
          title="生命值变化"
          series={result.hpCurve.length ? [
            { name: heros[0]?.label ?? 'A', color: 'var(--brand)', points: result.hpCurve.map((p) => ({ x: p.tMs / 1000, y: p.A })) },
            { name: heros[1]?.label ?? 'B', color: 'var(--bad)', points: result.hpCurve.map((p) => ({ x: p.tMs / 1000, y: p.B })) },
          ] : []}
          xLabel="秒" yLabel="生命值"
        />
      </Card>

      {primary && (
        <Card title="伤害构成">
          <div className="grid grid-3">
            <ShareBars items={damageShare(primary).map((d, i) => ({ ...d, color: ['#3b6cf0', '#2f7ae0', '#e07a2f', '#b02fe0'][i % 4] }))} />
            <ShareBars items={damageTypeShare(primary).map((d, i) => ({ ...d, color: ['#e07a2f', '#2f7ae0', '#b02fe0'][i % 3] }))} />
            <div>
              <div className="section-label">关键 DPS</div>
              <div className="stat-grid">
                <StatBox k="1s 平均" v={num(dpsUpTo(result, primary.id as CombatantId, 1))} />
                <StatBox k="3s 平均" v={num(dpsUpTo(result, primary.id as CombatantId, 3))} />
                <StatBox k="5s 平均" v={num(dpsUpTo(result, primary.id as CombatantId, 5))} />
                <StatBox k="10s 平均" v={num(dpsUpTo(result, primary.id as CombatantId, 10))} />
                <StatBox k="全程平均" v={num(avgDps(result, primary.id as CombatantId))} />
              </div>
            </div>
          </div>
        </Card>
      )}

      {primary && primary.skills.length > 0 && (
        <Card title="技能贡献">
          <table>
            <thead><tr><th>技能</th><th className="num">释放</th><th className="num">命中</th><th className="num">总伤</th><th className="num">暴击</th><th className="num">占比</th><th className="num">平均</th></tr></thead>
            <tbody>
              {primary.skills.map((s) => (
                <tr key={s.skillId}>
                  <td>{s.name}</td><td className="num">{s.castCount}</td><td className="num">{s.hitCount}</td>
                  <td className="num">{num(s.damage)}</td><td className="num">{s.critCount}</td>
                  <td className="num">{primary.damage.total ? pct((s.damage / primary.damage.total) * 100) : '0%'}</td>
                  <td className="num">{num(s.avgDamage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {primary && primary.items.length > 0 && (
        <Card title="装备贡献">
          <table>
            <thead><tr><th>装备</th><th className="num">触发</th><th className="num">伤害</th><th className="num">DPS</th><th className="num">治疗</th><th className="num">护盾</th></tr></thead>
            <tbody>
              {primary.items.map((it) => (
                <tr key={it.itemId}>
                  <td>{it.name}</td><td className="num">{it.procCount}</td>
                  <td className="num">{num(it.damage)}</td>
                  <td className="num">{num(result.durationMs > 0 ? it.damage / (result.durationMs / 1000) : 0)}</td>
                  <td className="num">{num(it.heal)}</td><td className="num">{num(it.shield)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="战斗时间轴">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>共 {result.events.length} 条事件</span>
        </div>
        <div className="tl">
          {result.events.map((e) => (
            <div key={e.eventId} className={'tl-item ' + (e.eventType === 'heal' ? 'heal' : e.eventType.startsWith('shield') ? 'shield' : e.eventType === 'death' ? 'death' : '')}>
              <span className="t">{fmtTime(e.timestampMs)}</span>
              <b> {e.description || e.eventType}</b>
              {e.finalDamage > 0 && <div className="detail">实际伤害 {num(e.finalDamage)}（原伤害 {num(e.rawDamage)}）{e.crit ? '· 暴击' : ''}</div>}
              {e.absorbedByShield > 0 && <div className="detail">护盾吸收 {num(e.absorbedByShield)}</div>}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function maxHit(result: CombatResult, id: CombatantId): number {
  let m = 0;
  for (const e of result.events) if (e.sourceId === id && e.finalDamage > m) m = e.finalDamage;
  return m;
}