import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button, Card, Field, Input } from '../components/ui';
import type { Snapshot } from '../db/db';
import { useStore } from '../store/useStore';
import { useUi } from '../store/ui';

export function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const counts = useStore(
    useShallow((s) => ({ w: s.warehouses.length, b: s.blocks.length, p: s.products.length, i: s.inventory.length, l: s.pickLists.length })),
  );
  const store = useStore.getState;
  const toast = useUi((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ format: 'warehouse-blueprint', version: 1, ...store().exportSnapshot() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `warehouse-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Partial<Snapshot> & { format?: string };
      if (data.format !== 'warehouse-blueprint' || !Array.isArray(data.warehouses)) throw new Error('Not a Warehouse Blueprint backup file.');
      if (!confirm('Replace ALL current data with this backup?')) return;
      await store().importSnapshot({
        warehouses: data.warehouses ?? [],
        blocks: data.blocks ?? [],
        products: data.products ?? [],
        inventory: data.inventory ?? [],
        pickLists: data.pickLists ?? [],
        sessions: data.sessions ?? [],
        settings: data.settings,
      });
      toast('Backup restored.', 'success');
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">Settings</h1>
      <Card title="Routing">
        <div className="flex flex-col gap-4">
          <Field label="Size of one grid cell (meters) — used to show walking distance">
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={settings.cellSizeMeters}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) store().updateSettings({ cellSizeMeters: v });
              }}
              className="w-28"
              aria-label="Cell size in meters"
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.aisleOnly}
              onChange={(e) => store().updateSettings({ aisleOnly: e.target.checked })}
            />
            <span>
              <strong>Walk on aisles only.</strong> When enabled, routes use only painted aisle cells (plus entrances/exits). When disabled, any
              open floor that is not a block or wall is walkable.
            </span>
          </label>
        </div>
      </Card>

      <Card title="Data">
        <p className="mb-3 text-sm text-slate-600">
          All data is stored locally in this browser (IndexedDB): {counts.w} layout(s), {counts.b} block(s), {counts.p} product(s), {counts.i} stock
          record(s), {counts.l} picking list(s). Export a backup to move data to another device.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportJson}>Export backup (.json)</Button>
          <Button onClick={() => fileRef.current?.click()}>Restore backup…</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importJson(e.target.files?.[0])} />
          <Button
            onClick={() => {
              store().loadSample();
              toast('Sample warehouse added and selected.', 'success');
            }}
          >
            Add sample warehouse
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('Delete ALL layouts, products, stock, picking lists and sessions from this browser?')) return;
              await store().clearAll();
              toast('All data cleared.');
            }}
          >
            Clear all data
          </Button>
        </div>
      </Card>
    </div>
  );
}
