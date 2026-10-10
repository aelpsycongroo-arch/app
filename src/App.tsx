import { useEffect } from 'react';
import { cx } from './components/ui';
import { ImportPage } from './pages/ImportPage';
import { MapPage } from './pages/MapPage';
import { ProductsPage } from './pages/ProductsPage';
import { RoutePage } from './pages/RoutePage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkerPage } from './pages/WorkerPage';
import { useActiveWarehouse, useStore } from './store/useStore';
import { PAGES, useUi } from './store/ui';

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const saveState = useStore((s) => s.saveState);
  const warehouses = useStore((s) => s.warehouses);
  const updateSettings = useStore((s) => s.updateSettings);
  const active = useActiveWarehouse();
  const page = useUi((s) => s.page);
  const navigate = useUi((s) => s.navigate);
  const toasts = useUi((s) => s.toasts);
  const activeSessions = useStore((s) => s.sessions.filter((x) => x.status === 'active').length);

  useEffect(() => {
    useStore.getState().init().catch((e) => useUi.getState().toast(`Could not open local database: ${e}`, 'error'));
  }, []);

  if (!loaded) return <div className="p-8 text-slate-500">Loading warehouse data…</div>;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900 text-slate-100">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            Warehouse Blueprint
          </div>
          <nav className="flex flex-wrap gap-1" aria-label="Main">
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(p.id)}
                aria-current={page === p.id ? 'page' : undefined}
                className={cx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  page === p.id ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )}
              >
                {p.label}
                {p.id === 'worker' && activeSessions > 0 && (
                  <span className="ml-1.5 rounded-full bg-emerald-500 px-1.5 text-xs text-white">{activeSessions}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {warehouses.length > 0 && (
              <label className="flex items-center gap-2 text-slate-300">
                <span className="hidden sm:inline">Layout</span>
                <select
                  aria-label="Active warehouse layout"
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100"
                  value={active?.id ?? ''}
                  onChange={(e) => updateSettings({ activeWarehouseId: e.target.value })}
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span
              data-testid="save-state"
              className={cx('text-xs', saveState === 'error' ? 'text-red-400' : saveState === 'saving' ? 'text-amber-300' : 'text-emerald-400')}
            >
              {saveState === 'error' ? 'Save failed' : saveState === 'saving' ? 'Saving…' : 'All changes saved'}
            </span>
          </div>
        </div>
      </header>
      <main className="flex-1">
        {page === 'map' && <MapPage />}
        {page === 'products' && <ProductsPage />}
        {page === 'import' && <ImportPage />}
        {page === 'route' && <RoutePage />}
        {page === 'worker' && <WorkerPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'rounded-md px-4 py-2 text-sm text-white shadow-lg',
              t.tone === 'error' ? 'bg-red-600' : t.tone === 'success' ? 'bg-emerald-600' : 'bg-slate-800',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
