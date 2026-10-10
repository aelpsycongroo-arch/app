import { useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, cx } from '../components/ui';
import { newId } from '../domain/ids';
import { floorLabel, locationCode, sortFloors } from '../domain/location';
import {
  autoAllocate,
  buildPickLines,
  extractRows,
  guessMapping,
  ISSUE_TEXT,
  matchRow,
  type ColumnMapping,
  type MatchedRow,
} from '../domain/matching';
import { SAMPLE_PICKING_CSV } from '../domain/sample';
import { parseCsvText, parseSpreadsheetFile, type ParsedSheet } from '../domain/spreadsheet';
import type { Block } from '../domain/types';
import { useImportDraft } from '../store/importDraft';
import { useActiveWarehouse, useStore } from '../store/useStore';
import { useUi } from '../store/ui';

export function ImportPage() {
  const warehouse = useActiveWarehouse();
  const draft = useImportDraft();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!warehouse) return <div className="p-6"><EmptyState title="No warehouse layout yet">Create a layout on the Warehouse Map first.</EmptyState></div>;

  const load = (fileName: string, sheets: ParsedSheet[]) => {
    const nonEmpty = sheets.findIndex((s) => s.rows.length > 0);
    const sheetIndex = Math.max(0, nonEmpty);
    const headers = sheets[sheetIndex]?.rows[0] ?? [];
    useImportDraft.getState().reset();
    useImportDraft.getState().patch({
      fileName,
      sheets,
      sheetIndex,
      hasHeader: true,
      mapping: guessMapping(headers),
      listName: fileName.replace(/\.[^.]+$/, ''),
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      load(file.name, await parseSpreadsheetFile(file));
    } catch (e) {
      toast(`Could not read ${file.name}: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="text-xl font-bold">Import picking list</h1>
      <p className="mb-4 text-sm text-slate-600">
        Upload an Excel (.xlsx, .xls) or CSV file. Each row is matched to registered inventory to find its exact block and floor — locations are
        never guessed.
      </p>

      <Card title="1. Upload file" className="mb-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFile(e.dataTransfer.files[0]);
          }}
          className={cx(
            'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center',
            dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300',
          )}
        >
          <p className="text-sm text-slate-600">Drag a file here, or</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? 'Reading…' : 'Choose file'}
            </Button>
            <Button onClick={() => load('sample-picking-list.csv', parseCsvText(SAMPLE_PICKING_CSV))}>Use sample picking list</Button>
            <a
              className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-indigo-700 hover:underline"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_PICKING_CSV)}`}
              download="sample-picking-list.csv"
            >
              Download sample CSV
            </a>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            data-testid="file-input"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {draft.fileName && (
            <p className="text-sm">
              Loaded <strong>{draft.fileName}</strong>
            </p>
          )}
        </div>
      </Card>

      {draft.sheets.length > 0 && <ImportSteps warehouseId={warehouse.id} />}
    </div>
  );
}

function ImportSteps({ warehouseId }: { warehouseId: string }) {
  const draft = useImportDraft();
  const products = useStore((s) => s.products);
  const inventory = useStore((s) => s.inventory);
  const blocks = useStore((s) => s.blocks);
  const toast = useUi((s) => s.toast);
  const sheet = draft.sheets[draft.sheetIndex];
  const headers = draft.hasHeader ? (sheet.rows[0] ?? []) : (sheet.rows[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const colCount = Math.max(0, ...sheet.rows.slice(0, 50).map((r) => r.length));
  const columns = Array.from({ length: colCount }, (_, i) => headers[i] || `Column ${i + 1}`);

  const ctx = useMemo(() => ({ warehouseId, products, inventory, blocks }), [warehouseId, products, inventory, blocks]);
  const raw = useMemo(() => extractRows(sheet.rows, draft.mapping, draft.hasHeader), [sheet, draft.mapping, draft.hasHeader]);
  const rows = useMemo(() => raw.map((r) => matchRow(r, draft.overrides[r.rowNumber], ctx)), [raw, draft.overrides, ctx]);
  const mappingOk = draft.mapping.quantity !== null && (draft.mapping.sku !== null || draft.mapping.name !== null);

  const ready = rows.filter((r) => r.ready);
  const excluded = rows.filter((r) => r.excluded);
  const attention = rows.filter((r) => !r.ready && !r.excluded);
  const multiLocation = attention.filter((r) => r.issues.includes('choose-location') && r.quantity !== null);

  const plannedBlocks = new Set(ready.flatMap((r) => r.allocations.map((a) => r.locations.find((l) => l.inventoryId === a.inventoryId)!.blockId)));

  const setMapping = (k: keyof ColumnMapping, v: string) => draft.patch({ mapping: { ...draft.mapping, [k]: v === '' ? null : Number(v) }, overrides: {} });

  const create = () => {
    const lines = buildPickLines(rows);
    const list = {
      id: newId(),
      warehouseId,
      name: draft.listName.trim() || draft.fileName,
      sourceFileName: draft.fileName,
      createdAt: Date.now(),
      lines,
    };
    useStore.getState().savePickList(list);
    useUi.getState().setSelectedPickList(list.id);
    toast(`Picking list "${list.name}" created with ${lines.length} line(s).`, 'success');
    draft.reset();
    useUi.getState().navigate('route');
  };

  return (
    <>
      <Card title="2. Preview" className="mb-4">
        <div className="mb-3 flex flex-wrap items-end gap-4">
          {draft.sheets.length > 1 && (
            <Field label="Sheet">
              <Select
                value={draft.sheetIndex}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  draft.patch({ sheetIndex: idx, mapping: guessMapping(draft.sheets[idx].rows[0] ?? []), overrides: {} });
                }}
              >
                {draft.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name} ({s.rows.length} rows)
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.hasHeader} onChange={(e) => draft.patch({ hasHeader: e.target.checked, overrides: {} })} />
            First row contains column headers
          </label>
          <span className="text-sm text-slate-500">{sheet.rows.length} rows in sheet</span>
        </div>
        <div className="max-h-64 overflow-auto rounded border border-slate-200">
          <table className="w-full text-xs" data-testid="preview-table">
            <thead className="sticky top-0 bg-slate-100">
              <tr>
                <th className="px-2 py-1 text-left text-slate-500">#</th>
                {columns.map((c, i) => (
                  <th key={i} className="px-2 py-1 text-left">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.slice(draft.hasHeader ? 1 : 0, 21).map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + (draft.hasHeader ? 2 : 1)}</td>
                  {columns.map((_, c) => (
                    <td key={c} className="px-2 py-1">
                      {r[c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sheet.rows.length > 21 && <p className="mt-1 text-xs text-slate-500">Showing the first 20 data rows.</p>}
      </Card>

      <Card title="3. Map columns" className="mb-4">
        <div className="flex flex-wrap gap-4">
          {(
            [
              ['sku', 'SKU / barcode column'],
              ['name', 'Product name column'],
              ['quantity', 'Requested quantity column *'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <Select value={draft.mapping[k] ?? ''} onChange={(e) => setMapping(k, e.target.value)} aria-label={label}>
                <option value="">— not in file —</option>
                {columns.map((c, i) => (
                  <option key={i} value={i}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
        {!mappingOk && <p className="mt-2 text-sm text-red-600">Map the quantity column and at least one of SKU or product name.</p>}
      </Card>

      {mappingOk && (
        <Card
          title="4. Match to inventory"
          actions={
            <>
              <Badge tone="green">{ready.length} ready</Badge>
              <Badge tone={attention.length ? 'red' : 'slate'}>{attention.length} need attention</Badge>
              {excluded.length > 0 && <Badge>{excluded.length} excluded</Badge>}
            </>
          }
          className="mb-4"
        >
          {(multiLocation.length > 0 || attention.length > 0) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {multiLocation.length > 0 && (
                <Button
                  onClick={() => {
                    const pref = new Set(plannedBlocks);
                    for (const r of multiLocation) {
                      const alloc = autoAllocate(r.quantity!, r.locations, pref);
                      alloc.forEach((a) => pref.add(r.locations.find((l) => l.inventoryId === a.inventoryId)!.blockId));
                      draft.setOverride(r.raw.rowNumber, (o) => ({ ...o, allocations: alloc }));
                    }
                  }}
                >
                  Auto-choose locations for {multiLocation.length} multi-location row(s)
                </Button>
              )}
              {attention.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => attention.forEach((r) => draft.setOverride(r.raw.rowNumber, (o) => ({ ...o, excluded: true })))}
                >
                  Exclude all unresolved rows
                </Button>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="match-table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">Row</th>
                  <th className="px-2 py-2">From file</th>
                  <th className="px-2 py-2">Qty</th>
                  <th className="px-2 py-2">Matched product</th>
                  <th className="px-2 py-2">Block / floor</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <MatchRowView key={r.raw.rowNumber} row={r} warehouseId={warehouseId} />
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="text-sm text-slate-500">No data rows found with the current mapping.</p>}
        </Card>
      )}

      {mappingOk && rows.length > 0 && (
        <Card title="5. Create picking list">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Picking list name">
              <Input value={draft.listName} onChange={(e) => draft.patch({ listName: e.target.value })} className="w-72" aria-label="Picking list name" />
            </Field>
            <Button variant="primary" size="lg" disabled={attention.length > 0 || ready.length === 0} onClick={create}>
              Create picking list & plan route
            </Button>
            {attention.length > 0 && (
              <span className="text-sm text-red-600">Resolve or exclude {attention.length} row(s) first.</span>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function MatchRowView({ row, warehouseId }: { row: MatchedRow; warehouseId: string }) {
  const draft = useImportDraft();
  const products = useStore((s) => s.products);
  const set = (fn: Parameters<typeof draft.setOverride>[1]) => draft.setOverride(row.raw.rowNumber, fn);
  const [productQuery, setProductQuery] = useState('');
  const listId = `import-products-${row.raw.rowNumber}`;
  const tone = row.excluded ? 'slate' : row.ready ? (row.warnings.length ? 'amber' : 'green') : 'red';

  return (
    <tr
      className={cx('border-t border-slate-100 align-top', row.excluded && 'opacity-50')}
      data-testid={`match-row-${row.raw.rowNumber}`}
      data-status={row.excluded ? 'excluded' : row.ready ? 'ready' : 'attention'}
    >
      <td className="px-2 py-2 text-slate-500">{row.raw.rowNumber}</td>
      <td className="px-2 py-2">
        <div className="font-mono text-xs">{row.raw.sku || '—'}</div>
        <div className="text-xs text-slate-500">{row.raw.name}</div>
      </td>
      <td className="px-2 py-2">
        <Input
          type="number"
          min={1}
          aria-label={`Quantity for row ${row.raw.rowNumber}`}
          value={row.quantity ?? ''}
          placeholder={row.raw.quantityText}
          onChange={(e) => {
            const q = Number(e.target.value);
            set((o) => {
              const next = { ...o, quantity: Number.isInteger(q) && q > 0 ? q : undefined };
              if (o.allocations?.length === 1 && next.quantity) next.allocations = [{ ...o.allocations[0], quantity: next.quantity }];
              return next;
            });
          }}
          className={cx('w-20', row.issues.includes('invalid-quantity') && 'border-red-400')}
        />
      </td>
      <td className="px-2 py-2">
        {row.product ? (
          <div>
            <div className="font-medium">{row.product.name}</div>
            <div className="text-xs text-slate-500">
              {row.product.sku} · matched by {row.matchedBy}
              {row.matchedBy === 'manual' && (
                <button type="button" className="ml-1 text-indigo-600 hover:underline" onClick={() => set((o) => ({ ...o, productId: undefined, allocations: undefined }))}>
                  undo
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {row.suggestions.map((p) => (
              <Button key={p.id} size="sm" onClick={() => set((o) => ({ ...o, productId: p.id, allocations: undefined }))}>
                Use {p.sku} — {p.name}?
              </Button>
            ))}
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const q = productQuery.trim().toLowerCase();
                const p = products.find((x) => `${x.sku} — ${x.name}`.toLowerCase() === q || x.sku.toLowerCase() === q);
                if (p) set((o) => ({ ...o, productId: p.id, allocations: undefined }));
              }}
            >
              <Input list={listId} placeholder="Choose product…" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} className="w-44" aria-label={`Choose product for row ${row.raw.rowNumber}`} />
              <datalist id={listId}>
                {products.map((p) => (
                  <option key={p.id} value={`${p.sku} — ${p.name}`} />
                ))}
              </datalist>
              <Button size="sm" type="submit">
                Set
              </Button>
            </form>
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        <LocationCell row={row} warehouseId={warehouseId} onAllocate={(a) => set((o) => ({ ...o, allocations: a }))} />
      </td>
      <td className="px-2 py-2">
        <Badge tone={tone}>{row.excluded ? 'Excluded' : row.ready ? 'Ready' : 'Needs attention'}</Badge>
        {!row.excluded &&
          row.issues.map((i) => (
            <div key={i} className="mt-1 text-xs text-red-700">
              {ISSUE_TEXT[i]}
            </div>
          ))}
        {!row.excluded &&
          row.warnings.map((w) => (
            <div key={w} className="mt-1 text-xs text-amber-700">
              {w}
            </div>
          ))}
      </td>
      <td className="px-2 py-2 text-right">
        <Button size="sm" variant="ghost" onClick={() => set((o) => ({ ...o, excluded: !o.excluded }))}>
          {row.excluded ? 'Include' : 'Exclude'}
        </Button>
      </td>
    </tr>
  );
}

function LocationCell({ row, warehouseId, onAllocate }: { row: MatchedRow; warehouseId: string; onAllocate: (a: { inventoryId: string; quantity: number }[]) => void }) {
  if (!row.product) return <span className="text-slate-400">—</span>;
  if (row.locations.length === 0) return <RegisterLocation productId={row.product.id} quantity={row.quantity ?? 0} warehouseId={warehouseId} />;
  if (row.locations.length === 1) {
    const l = row.locations[0];
    return (
      <Badge tone="indigo" className="font-mono">
        {l.code} <span className="font-sans text-slate-500">({l.available} in stock)</span>
      </Badge>
    );
  }
  const single = row.allocations.length === 1 ? row.allocations[0].inventoryId : row.allocations.length > 1 ? '__split' : '';
  return (
    <div className="flex flex-col gap-1">
      <Select
        value={single}
        aria-label={`Location for row ${row.raw.rowNumber}`}
        className={cx(!row.allocations.length && 'border-red-400')}
        onChange={(e) => {
          if (e.target.value && e.target.value !== '__split') onAllocate([{ inventoryId: e.target.value, quantity: row.quantity ?? 1 }]);
        }}
      >
        <option value="">Choose location…</option>
        {row.locations.map((l) => (
          <option key={l.inventoryId} value={l.inventoryId}>
            {l.code} ({l.available} in stock)
          </option>
        ))}
        {row.allocations.length > 1 && <option value="__split">Split across locations</option>}
      </Select>
      {row.allocations.length > 1 && (
        <div className="text-xs text-slate-600">
          {row.allocations.map((a) => `${row.locations.find((l) => l.inventoryId === a.inventoryId)!.code} × ${a.quantity}`).join(', ')}
        </div>
      )}
    </div>
  );
}

function RegisterLocation({ productId, quantity, warehouseId }: { productId: string; quantity: number; warehouseId: string }) {
  const allBlocks = useStore((s) => s.blocks);
  const toast = useUi((s) => s.toast);
  const blocks = allBlocks.filter((b) => b.warehouseId === warehouseId).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const [blockId, setBlockId] = useState('');
  const [floorId, setFloorId] = useState('');
  const block: Block | undefined = blocks.find((b) => b.id === blockId);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-red-700">No location registered.</span>
      <div className="flex gap-1">
        <Select
          value={blockId}
          aria-label="Register block"
          onChange={(e) => {
            setBlockId(e.target.value);
            setFloorId(blocks.find((b) => b.id === e.target.value)?.floors[0]?.id ?? '');
          }}
        >
          <option value="">Block…</option>
          {blocks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </Select>
        <Select value={floorId} onChange={(e) => setFloorId(e.target.value)} disabled={!block} aria-label="Register floor">
          {block && sortFloors(block.floors).map((f) => <option key={f.id} value={f.id}>{floorLabel(f)}</option>)}
        </Select>
        <Button
          size="sm"
          disabled={!block || !floorId}
          title="Records that this product is stored here, with the requested quantity as stock"
          onClick={() => {
            const err = useStore.getState().assignStock(productId, blockId, floorId, quantity);
            if (err) toast(err, 'error');
            else toast(`Location ${locationCode(block!, block!.floors.find((f) => f.id === floorId)!)} registered.`, 'success');
          }}
        >
          Register
        </Button>
      </div>
    </div>
  );
}
