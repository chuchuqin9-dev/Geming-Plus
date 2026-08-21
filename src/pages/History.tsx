/**
 * 历史记录：已保存的战斗模拟结果（含快照，与模板解耦），可查看与删除
 */
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card, num } from '../components/ui';
import type { SavedSimulation } from '../core/types';

export function History() {
  const { savedSimulations, removeSimulation, toggleFavorite } = useAppStore();
  const [expand, setExpand] = useState<string | null>(null);
  const sorted = useMemo(() => [...savedSimulations].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [savedSimulations]);

  return (
    <div style={{ maxWidth: 900 }}>
      <Card title={`模拟历史 (${sorted.length})`}>
        {!sorted.length && <p className="muted">暂无历史记录。在「战斗模拟」运行后点「保存到历史」。</p>}
        {sorted.map((s) => {
          const res = s.result;
          const r = res.results.find((x) => x.isHero);
          return (
            <div key={s.id} className="card" style={{ marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{s.name}</b>
                <span className="muted" style={{ fontSize: 12 }}>{new Date(s.createdAt).toLocaleString()}</span>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="badge">{res.config.mode === 'dummy' ? '打木桩' : 'VS'}</span>
                <span className="badge">时长 {(res.durationMs / 1000).toFixed(1)}s</span>
                {r && <span className="badge">总伤 {num(r.damage.total)}</span>}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => toggleFavorite('sim', s.id)}>{s.favorite ? '★ 已收藏' : '☆ 收藏'}</button>
                <button className="btn sm" onClick={() => setExpand(expand === s.id ? null : s.id)}>{expand === s.id ? '收起' : '查看事件'}</button>
                <button className="btn sm danger" onClick={() => removeSimulation(s.id)}>删除</button>
              </div>
              {expand === s.id && <TimelinePreview sim={s} />}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function TimelinePreview({ sim }: { sim: SavedSimulation }) {
  const events = sim.result.events.slice(-40);
  return (
    <div className="tl" style={{ maxHeight: 300, marginTop: 10 }}>
      {events.map((e) => (
        <div key={e.eventId} className="tl-item">
          <span className="t">{(e.timestampMs / 1000).toFixed(3)}s</span>
          <b> {e.description || e.eventType}</b>
        </div>
      ))}
    </div>
  );
}