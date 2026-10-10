import { Fragment, useMemo, useState } from 'react';
import { QtyInput } from '../components/BlockPanel';
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '../components/ui';
import { floorLabel, locationCode, sortFloors } from '../domain/location';
import type { Block, Floor, InventoryRecord, Product } from '../domain/types';
import { useActiveWarehouse, useStore } from '../store/useStore';
import { useUi } from '../store/ui';

const EMPTY = { sku: '', barcode: '', name: '', category: '' };

export function ProductsPage() {
  const warehouse = useActiveWarehouse();
  const products = useStore((s) => s.products);
  const inventory = useStore((s) => s.inventory);
  const allBlocks = useStore((s) => s.blocks);
  const store = useStore.getState;
  const toast = useUi((s) => s.toast);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<(Omit<Product, 'id'> & { id?: string }) | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const blocks = useMemo(() => allBlocks.filter((b) => b.warehouseId === warehouse?.id), [allBlocks, warehouse?.id]);
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const filtered = products
    .filter((p) => (!category || p.category === category) && (!q || [p.sku, p.barcode, p.name, p.category].some((v) => v.toLowerCase().includes(q))))
    .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));

  const locationsOf = (productId: string) =>
    inventory
      .filter((r) => r.productId === productId && r.warehouseId === warehouse?.id)
      .map((r) => {
        const block = blocks.find((b) => b.id === r.blockId);
        const floor = block?.floors.find((f) => f.id === r.floorId);
        return { record: r, block, floor, code: block && floor ? locationCode(block, floor) : '?' };
      })
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const save = () => {
    if (!editing) return;
    const res = store().saveProduct(editing);
    if (res.error) return toast(res.error, 'error');
    toast(`Saved ${res.product!.sku}.`, 'success');
    if (!editing.id) setExpanded(res.product!.id);
    setEditing(null);
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-sm text-slate-600">
            {products.length} products · stock shown for layout <strong>{warehouse?.name ?? '—'}</strong>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Input type="search" placeholder="Search SKU, name, barcode…" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Button variant="primary" onClick={() => setEditing({ ...EMPTY })}>
            + Add product
          </Button>
        </div>
      </div>

      {editing && (
        <Card title={editing.id ? `Edit ${editing.sku}` : 'New product'} className="mb-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label="SKU *">
              <Input value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} autoFocus aria-label="SKU" />
            </Field>
            <Field label="Barcode">
              <Input value={editing.barcode} onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} aria-label="Barcode" />
            </Field>
            <Field label="Product name *" className="min-w-64 flex-1">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Product name" />
            </Field>
            <Field label="Category">
              <Input list="categories" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} aria-label="Category" />
              <datalist id="categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Button type="submit" variant="primary">
              Save product
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </form>
        </Card>
      )}

      {products.length === 0 ? (
        <EmptyState title="No products yet">Add products here, or assign them directly from a block on the Warehouse Map.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">In stock</th>
                <th className="px-3 py-2">Locations (block-floor × qty)</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const locs = locationsOf(p.id);
                const total = locs.reduce((s, l) => s + l.record.quantity, 0);
                const open = expanded === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr className="border-t border-slate-100" data-testid={`product-row-${p.sku}`}>
                      <td className="px-3 py-2 font-mono text-xs">
                        {p.sku}
                        {p.barcode && <div className="text-slate-400">{p.barcode}</div>}
                      </td>
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 text-slate-600">{p.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{total}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {locs.length === 0 ? (
                            <Badge tone="red">No location</Badge>
                          ) : (
                            locs.map((l) => (
                              <Badge key={l.record.id} tone="indigo" className="font-mono">
                                {l.code} × {l.record.quantity}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Button size="sm" variant={open ? 'primary' : 'secondary'} onClick={() => setExpanded(open ? null : p.id)}>
                          Locations
                        </Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ ...p })}>
                          Edit
                        </Button>{' '}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => confirm(`Delete ${p.sku} — ${p.name} and all its stock records?`) && store().deleteProduct(p.id)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-6 py-3">
                          <LocationEditor productId={p.id} locs={locs} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-4 text-sm text-slate-500">No products match the filter.</p>}
        </div>
      )}
    </div>
  );
}

function LocationEditor({
  productId,
  locs,
}: {
  productId: string;
  locs: { record: InventoryRecord; code: string; block?: Block; floor?: Floor }[];
}) {
  const warehouse = useActiveWarehouse();
  const allBlocks = useStore((s) => s.blocks);
  const store = useStore.getState;
  const toast = useUi((s) => s.toast);
  const blocks = allBlocks
    .filter((b) => b.warehouseId === warehouse?.id)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const [blockId, setBlockId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [qty, setQty] = useState('1');
  const block = blocks.find((b) => b.id === blockId);

  return (
    <div className="flex flex-col gap-3">
      {locs.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {locs.map((l) => (
            <li key={l.record.id} className="flex items-center gap-3">
              <Badge tone="indigo" className="w-16 justify-center font-mono">
                {l.code}
              </Badge>
              <span className="w-56 text-slate-600">
                Block {l.block?.code} · {l.floor ? floorLabel(l.floor) : '?'}
              </span>
              <QtyInput
                value={l.record.quantity}
                label={`Quantity at ${l.code}`}
                onCommit={(q) => {
                  const err = store().setStockQuantity(l.record.id, q);
                  if (err) toast(err, 'error');
                }}
              />
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => store().removeStock(l.record.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {blocks.length === 0 ? (
        <p className="text-sm text-slate-500">Create blocks on the Warehouse Map before assigning locations.</p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const err = store().assignStock(productId, blockId, floorId, Number(qty));
            if (err) toast(err, 'error');
            else {
              toast('Location assigned.', 'success');
              setQty('1');
            }
          }}
        >
          <Field label="Block">
            <Select
              value={blockId}
              aria-label="Block"
              onChange={(e) => {
                setBlockId(e.target.value);
                setFloorId(blocks.find((b) => b.id === e.target.value)?.floors[0]?.id ?? '');
              }}
            >
              <option value="">Choose…</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  Block {b.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Floor">
            <Select value={floorId} onChange={(e) => setFloorId(e.target.value)} disabled={!block} aria-label="Floor">
              {block &&
                sortFloors(block.floors).map((f) => (
                  <option key={f.id} value={f.id}>
                    {floorLabel(f)} ({locationCode(block, f)})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Quantity">
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-24" aria-label="Location quantity" />
          </Field>
          <Button type="submit" variant="primary" disabled={!block || !floorId}>
            Add location
          </Button>
        </form>
      )}
    </div>
  );
}
