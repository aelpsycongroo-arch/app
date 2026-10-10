import { useMemo, useState } from 'react';
import { floorLabel, locationCode, sortFloors } from '../domain/location';
import type { Block, Floor, InventoryRecord, Product } from '../domain/types';
import { useStore } from '../store/useStore';
import { useUi } from '../store/ui';
import { Badge, Button, Field, Input } from './ui';

export function deleteBlockWithConfirm(block: Block, after: () => void) {
  const stock = useStore.getState().inventory.filter((r) => r.blockId === block.id).length;
  const msg = stock ? `Delete block ${block.code}? Its ${stock} product assignment(s) will also be removed.` : `Delete block ${block.code}?`;
  if (!confirm(msg)) return;
  useStore.getState().deleteBlock(block.id);
  after();
}

export function BlockPanel({ block, onClose }: { block: Block; onClose: () => void }) {
  const store = useStore.getState;
  const toast = useUi((s) => s.toast);
  const inventory = useStore((s) => s.inventory);
  const products = useStore((s) => s.products);
  const [code, setCode] = useState(block.code);
  const [search, setSearch] = useState('');
  const [assignFloor, setAssignFloor] = useState<string | null>(null);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const records = inventory.filter((r) => r.blockId === block.id);
  const q = search.trim().toLowerCase();
  const matches = (p: Product | undefined) =>
    !q || (p && [p.sku, p.name, p.category, p.barcode].some((v) => v.toLowerCase().includes(q)));
  const floors = sortFloors(block.floors);
  const totalUnits = records.reduce((s, r) => s + r.quantity, 0);

  const saveCode = () => {
    if (code === block.code) return;
    const err = store().updateBlock(block.id, { code });
    if (err) {
      toast(err, 'error');
      setCode(block.code);
    } else setCode(code.trim().toUpperCase());
  };

  return (
    <div className="flex flex-col" data-testid="block-panel">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-semibold">Block</h2>
        <Input
          aria-label="Block ID"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onBlur={saveCode}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-24 text-lg font-bold"
        />
        <span className="text-sm text-slate-500">
          {floors.length} floors · {records.length} SKUs · {totalUnits} units
        </span>
        <Button variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close panel">
          ✕
        </Button>
      </div>

      <Geometry block={block} />

      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
        <Input
          type="search"
          placeholder="Search products in this block…"
          aria-label="Search products in this block"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Button variant="secondary" onClick={() => store().addFloor(block.id)}>
          + Add floor
        </Button>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-semibold">Floor</th>
            <th className="px-2 py-2 font-semibold">Products</th>
            <th className="px-2 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {floors.map((floor) => {
            const floorRecords = records.filter((r) => r.floorId === floor.id && matches(productById.get(r.productId)));
            if (q && floorRecords.length === 0) return null;
            return (
              <FloorRow
                key={floor.id}
                block={block}
                floor={floor}
                records={floorRecords.map((r) => ({ record: r, product: productById.get(r.productId)! }))}
                assigning={assignFloor === floor.id}
                onAssign={() => setAssignFloor(assignFloor === floor.id ? null : floor.id)}
              />
            );
          })}
        </tbody>
      </table>
      {q && !records.some((r) => matches(productById.get(r.productId))) && (
        <p className="px-4 py-3 text-sm text-slate-500">No products in block {block.code} match “{search}”.</p>
      )}
      {floors.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">This block has no floors. Add one to store products.</p>}

      <div className="mt-auto border-t border-slate-200 p-4">
        <Button variant="danger" onClick={() => deleteBlockWithConfirm(block, onClose)}>
          Delete block {block.code}
        </Button>
      </div>
    </div>
  );
}

function Geometry({ block }: { block: Block }) {
  const toast = useUi((s) => s.toast);
  const [vals, setVals] = useState({ x: block.x + 1, y: block.y + 1, w: block.w, h: block.h });
  const [prev, setPrev] = useState(block);
  if (prev !== block) {
    setPrev(block);
    setVals({ x: block.x + 1, y: block.y + 1, w: block.w, h: block.h });
  }
  const commit = () => {
    const patch = { x: vals.x - 1, y: vals.y - 1, w: vals.w, h: vals.h };
    if (patch.x === block.x && patch.y === block.y && patch.w === block.w && patch.h === block.h) return;
    const err = useStore.getState().updateBlock(block.id, patch);
    if (err) {
      toast(err, 'error');
      setVals({ x: block.x + 1, y: block.y + 1, w: block.w, h: block.h });
    }
  };
  const field = (k: keyof typeof vals, label: string) => (
    <Field label={label}>
      <Input
        type="number"
        min={1}
        value={vals[k]}
        aria-label={`Block ${label.toLowerCase()}`}
        onChange={(e) => setVals({ ...vals, [k]: Number(e.target.value) })}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="w-16"
      />
    </Field>
  );
  return (
    <div className="flex gap-3 border-b border-slate-200 px-4 py-2">
      {field('x', 'Column')}
      {field('y', 'Row')}
      {field('w', 'Width')}
      {field('h', 'Depth')}
    </div>
  );
}

function FloorRow({
  block,
  floor,
  records,
  assigning,
  onAssign,
}: {
  block: Block;
  floor: Floor;
  records: { record: InventoryRecord; product: Product }[];
  assigning: boolean;
  onAssign: () => void;
}) {
  const store = useStore.getState;
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(floor.name);
  const code = locationCode(block, floor);

  return (
    <>
      <tr className="border-t border-slate-100 align-top" data-testid={`floor-row-${code}`}>
        <td className="px-4 py-2">
          {editing ? (
            <Input
              autoFocus
              value={name}
              aria-label="Floor name"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                store().renameFloor(block.id, floor.id, name);
                setEditing(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-28"
            />
          ) : (
            <div className="whitespace-nowrap font-medium">{floorLabel(floor)}</div>
          )}
          <Badge tone="indigo" className="mt-1 font-mono">
            {code}
          </Badge>
        </td>
        <td className="px-2 py-2">
          {records.length === 0 ? (
            <span className="text-slate-400">Empty</span>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {records.map(({ record, product }) => (
                <li key={record.id} className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={product.name}>
                      {product.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {product.sku}
                      {product.category && ` · ${product.category}`}
                    </div>
                  </div>
                  <QtyInput
                    value={record.quantity}
                    label={`Quantity of ${product.sku} at ${code}`}
                    onCommit={(q) => {
                      const err = store().setStockQuantity(record.id, q);
                      if (err) toast(err, 'error');
                    }}
                  />
                  <button
                    type="button"
                    className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remove ${product.sku} from ${code}`}
                    onClick={() => store().removeStock(record.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" variant={records.length ? 'secondary' : 'primary'} onClick={onAssign}>
              {assigning ? 'Cancel' : 'Assign product'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Rename
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() => {
                if (records.length && !confirm(`Remove ${floorLabel(floor)}? Its ${records.length} product assignment(s) will be removed.`)) return;
                store().removeFloor(block.id, floor.id);
              }}
            >
              Remove
            </Button>
          </div>
        </td>
      </tr>
      {assigning && (
        <tr className="bg-indigo-50/60">
          <td colSpan={3} className="px-4 py-3">
            <AssignForm block={block} floor={floor} onDone={onAssign} />
          </td>
        </tr>
      )}
    </>
  );
}

export function QtyInput({ value, onCommit, label }: { value: number; onCommit: (q: number) => void; label: string }) {
  const [v, setV] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setV(String(value));
  }
  const commit = () => {
    const n = Number(v);
    if (String(n) === String(value)) return;
    if (!Number.isInteger(n) || n < 0) {
      setV(String(value));
      return;
    }
    onCommit(n);
  };
  return (
    <Input
      type="number"
      min={0}
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="w-20 text-right"
    />
  );
}

function AssignForm({ block, floor, onDone }: { block: Block; floor: Floor; onDone: () => void }) {
  const store = useStore.getState;
  const products = useStore((s) => s.products);
  const toast = useUi((s) => s.toast);
  const [mode, setMode] = useState<'existing' | 'new'>(products.length ? 'existing' : 'new');
  const [query, setQuery] = useState('');
  const [qty, setQty] = useState('1');
  const [draft, setDraft] = useState({ sku: '', name: '', category: '', barcode: '' });
  const listId = `products-${floor.id}`;

  const resolve = () => {
    const q = query.trim().toLowerCase();
    return products.find((p) => `${p.sku} — ${p.name}`.toLowerCase() === q || p.sku.toLowerCase() === q || p.barcode.toLowerCase() === q);
  };

  const submit = () => {
    const quantity = Number(qty);
    if (!Number.isInteger(quantity) || quantity < 0) return toast('Quantity must be a whole number ≥ 0.', 'error');
    let product: Product | undefined;
    if (mode === 'existing') {
      product = resolve();
      if (!product) return toast('Choose a product from the list (type SKU or name).', 'error');
    } else {
      const res = store().saveProduct(draft);
      if (res.error) return toast(res.error, 'error');
      product = res.product;
    }
    const err = store().assignStock(product!.id, block.id, floor.id, quantity);
    if (err) return toast(err, 'error');
    toast(`${product!.name} assigned to ${locationCode(block, floor)}.`, 'success');
    onDone();
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-3 text-xs font-medium">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Existing product
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New product
        </label>
      </div>
      {mode === 'existing' ? (
        <Field label="Product (SKU or name)">
          <Input list={listId} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing…" autoFocus aria-label="Product" />
          <datalist id={listId}>
            {products.map((p) => (
              <option key={p.id} value={`${p.sku} — ${p.name}`} />
            ))}
          </datalist>
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="SKU">
            <Input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} autoFocus aria-label="New SKU" />
          </Field>
          <Field label="Barcode (optional)">
            <Input value={draft.barcode} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} />
          </Field>
          <Field label="Product name">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="New product name" />
          </Field>
          <Field label="Category">
            <Input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </Field>
        </div>
      )}
      <div className="flex items-end gap-2">
        <Field label="Quantity">
          <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-24" aria-label="Quantity to assign" />
        </Field>
        <Button type="submit" variant="primary">
          Assign to {locationCode(block, floor)}
        </Button>
      </div>
    </form>
  );
}
