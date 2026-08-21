import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useAppStore } from './store/useAppStore';
import './styles/global.css';

// 主题引导：遵循上次保存或系统偏好
function bootstrapTheme() {
  const saved = localStorage.getItem('theme');
  const resolved = saved && saved !== 'system'
    ? saved
    : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', resolved);
}

bootstrapTheme();

function Root() {
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);
  const lastError = useAppStore((s) => s.lastError);
  useEffect(() => { void init(); }, [init]);
  return !ready && !lastError ? (
    <div style={{ padding: 40, color: 'var(--text-dim)' }}>正在载入本地数据…</div>
  ) : <App />;
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Root />
  </BrowserRouter>
);