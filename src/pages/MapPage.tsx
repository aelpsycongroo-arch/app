import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BlockPanel, deleteBlockWithConfirm } from '../components/BlockPanel';
import { Blueprint, BlueprintLegend } from '../components/Blueprint';
import { Badge, Button, Card, Field, Input, Select, cx } from '../components/ui';
import { blockContains, validateBlockRect } from '../domain/grid';
import type { AccessPoint, Block, GridPoint, Warehouse } from '../domain/types';
import { MAX_GRID, useActiveWarehouse, useStore } from '../store/useStore';
import { useUi } from '../store/ui';

type Tool = 'select' | 'block' | 'aisle' | 'wall' | 'erase' | 'entrance' | 'exit';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select / Move', hint: 'Click a block to open it. Drag blocks or entrance/exit markers to move them.' },
  { id: 'block', label: 'Add block', hint: 'Drag a rectangle to draw a block, or click to drop a 2×2 block.' },
  { id: 'aisle', label: 'Add aisle', hint: 'Click or drag to paint walking aisles.' },
  { id: 'wall', label: 'Wall / obstacle', hint: 'Click or drag to paint walls and obstacles the route must avoid.' },
  { id: 'erase', label: 'Erase', hint: 'Click or drag to clear aisles and walls back to open floor.' },
  { id: 'entrance', label: 'Set entrance', hint: 'Click an open cell to add an entrance.' },
  { id: 'exit', label: 'Set exit', hint: 'Click an open cell to add an exit.' },
];

type Drag =
  | { kind: 'move-block'; block: Block; offX: number; offY: number; moved: boolean }
  | { kind: 'move-point'; point: AccessPoint; moved: boolean }
  | { kind: 'draw-block'; start: GridPoint; end: GridPoint }
  | { kind: 'paint' };

export function MapPage() {
  const warehouse = useActiveWarehouse();
  if (!warehouse) return <Welcome />;
  return <Editor key={warehouse.id} warehouse={warehouse} />;
}

function Welcome() {
  const createWarehouse = useStore((s) => s.createWarehouse);
  const loadSample = useStore((s) => s.loadSample);
  const [name, setName] = useState('Main Warehouse');
  const [w, setW] = useState(24);
  const [h, setH] = useState(16);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Set up your warehouse</h1>
      <p className="mb-6 text-slate-600">
        Draw a top-down blueprint of storage blocks, assign products to each block's floors, then import a picking list to get a walking route.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Start with a blank layout">
          <div className="flex flex-col gap-3">
            <Field label="Layout name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="flex gap-3">
              <Field label="Width (cells)">
                <Input type="number" min={4} max={MAX_GRID} value={w} onChange={(e) => setW(Number(e.target.value))} className="w-24" />
              </Field>
              <Field label="Height (cells)">
                <Input type="number" min={4} max={MAX_GRID} value={h} onChange={(e) => setH(Number(e.target.value))} className="w-24" />
              </Field>
            </div>
            <Button variant="primary" onClick={() => createWarehouse(name, w, h)}>
              Create blank warehouse
            </Button>
          </div>
        </Card>
        <Card title="Explore with sample data">
          <p className="mb-4 text-sm text-slate-600">
            Loads a 24×16 warehouse with blocks A–G, aisles, a wall, two entrances, an exit and 15 snack/drink products assigned to specific
            floors.
          </p>
          <Button variant="secondary" onClick={() => loadSample()}>
            Load sample warehouse
          </Button>
        </Card>
      </div>
    </div>
  );
}

function Editor({ warehouse }: { warehouse: Warehouse }) {
  const allBlocks = useStore((s) => s.blocks);
  const inventory = useStore((s) => s.inventory);
  const store = useStore.getState;
  const toast = useUi((s) => s.toast);
  const blocks = useMemo(() => allBlocks.filter((b) => b.warehouseId === warehouse.id), [allBlocks, warehouse.id]);
  const stocked = useMemo(() => new Set(inventory.filter((r) => r.quantity > 0).map((r) => r.blockId)), [inventory]);

  const [tool, setTool] = useState<Tool>('select');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number; valid: boolean } | null>(null);
  const [zoom, setZoom] = useState(32);
  const drag = useRef<Drag | null>(null);

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const selectedPoint = warehouse.points.find((p) => p.id === selectedPointId) ?? null;
  const blockAt = (c: GridPoint) => blocks.find((b) => blockContains(b, c.x, c.y));
  const pointAt = (c: GridPoint) => warehouse.points.find((p) => p.x === c.x && p.y === c.y);

  const select = (blockId: string | null, pointId: string | null = null) => {
    setSelectedBlockId(blockId);
    setSelectedPointId(pointId);
  };

  const drawRect = (a: GridPoint, b: GridPoint) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
  };

  const paint = (c: GridPoint) => {
    const kind = tool === 'aisle' ? 'aisle' : tool === 'wall' ? 'wall' : null;
    store().paintCells(warehouse.id, [c], kind);
  };

  const onDown = (c: GridPoint, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    switch (tool) {
      case 'select': {
        const p = pointAt(c);
        if (p) {
          select(null, p.id);
          drag.current = { kind: 'move-point', point: p, moved: false };
          return;
        }
        const b = blockAt(c);
        if (b) {
          select(b.id);
          drag.current = { kind: 'move-block', block: b, offX: c.x - b.x, offY: c.y - b.y, moved: false };
          return;
        }
        select(null);
        return;
      }
      case 'block': {
        const existing = blockAt(c);
        if (existing) {
          select(existing.id);
          return;
        }
        drag.current = { kind: 'draw-block', start: c, end: c };
        const r = drawRect(c, c);
        setGhost({ ...r, valid: !validateBlockRect(warehouse, blocks, r) });
        return;
      }
      case 'aisle':
      case 'wall':
      case 'erase':
        drag.current = { kind: 'paint' };
        paint(c);
        return;
      case 'entrance':
      case 'exit': {
        const err = store().addPoint(warehouse.id, tool, c);
        if (err) toast(err, 'error');
        else {
          const pts = store().warehouses.find((w) => w.id === warehouse.id)!.points;
          select(null, pts[pts.length - 1].id);
        }
        return;
      }
    }
  };

  const onMove = (c: GridPoint) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'paint') paint(c);
    else if (d.kind === 'draw-block') {
      d.end = c;
      const r = drawRect(d.start, c);
      setGhost({ ...r, valid: !validateBlockRect(warehouse, blocks, r) });
    } else if (d.kind === 'move-block') {
      const r = { x: c.x - d.offX, y: c.y - d.offY, w: d.block.w, h: d.block.h };
      if (!d.moved && r.x === d.block.x && r.y === d.block.y) return;
      d.moved = true;
      setGhost({ ...r, valid: !validateBlockRect(warehouse, blocks, r, d.block.id) });
    } else if (d.kind === 'move-point') {
      if (!d.moved && c.x === d.point.x && c.y === d.point.y) return;
      d.moved = true;
      setGhost({ x: c.x, y: c.y, w: 1, h: 1, valid: true });
    }
  };

  const onUp = (c: GridPoint) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (!d) return;
    if (d.kind === 'draw-block') {
      let r = drawRect(d.start, d.end);
      if (r.w === 1 && r.h === 1) {
        const big = { ...r, w: 2, h: 2 };
        if (!validateBlockRect(warehouse, blocks, big)) r = big;
      }
      const res = store().addBlock(warehouse.id, r);
      if (res.error) toast(res.error, 'error');
      else {
        select(res.block!.id);
        toast(`Block ${res.block!.code} added with 3 floors.`, 'success');
      }
    } else if (d.kind === 'move-block' && d.moved) {
      const err = store().updateBlock(d.block.id, { x: c.x - d.offX, y: c.y - d.offY });
      if (err) toast(err, 'error');
    } else if (d.kind === 'move-point' && d.moved) {
      const err = store().updatePoint(warehouse.id, d.point.id, { x: c.x, y: c.y });
      if (err) toast(err, 'error');
    }
  };

  const hint = TOOLS.find((t) => t.id === tool)!.hint;

  return (
    <div className="flex flex-col lg:h-[calc(100vh-49px)] lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <LayoutBar warehouse={warehouse} zoom={zoom} setZoom={setZoom} />
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-2" role="toolbar" aria-label="Map tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              className={cx(
                'rounded-md border px-3 py-1.5 text-sm font-medium',
                tool === t.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {t.label}
            </button>
          ))}
          <Button
            variant="danger"
            className="ml-auto"
            disabled={!selectedBlock && !selectedPoint}
            onClick={() => {
              if (selectedBlock) deleteBlockWithConfirm(selectedBlock, () => select(null));
              else if (selectedPoint) {
                store().removePoint(warehouse.id, selectedPoint.id);
                select(null);
              }
            }}
          >
            Delete selected
          </Button>
        </div>
        <p className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">{hint}</p>
        <div className="flex-1 overflow-auto p-4">
          <div className="inline-block rounded-md bg-white p-2 shadow-sm ring-1 ring-slate-200">
            <Blueprint
              warehouse={warehouse}
              blocks={blocks}
              stockedBlockIds={stocked}
              selectedBlockId={selectedBlockId}
              selectedPointId={selectedPointId}
              ghost={ghost}
              cellPx={zoom}
              cursor={tool === 'select' ? 'default' : 'crosshair'}
              onCellDown={onDown}
              onCellMove={onMove}
              onCellUp={onUp}
            />
          </div>
          <div className="mt-3">
            <BlueprintLegend items={['empty', 'stocked', 'selected', 'aisle', 'wall', 'points']} />
          </div>
        </div>
      </div>
      <aside className="w-full shrink-0 overflow-y-auto border-l border-slate-200 bg-white lg:w-[440px]">
        {selectedBlock ? (
          <BlockPanel key={selectedBlock.id} block={selectedBlock} onClose={() => select(null)} />
        ) : selectedPoint ? (
          <PointPanel key={selectedPoint.id} warehouse={warehouse} point={selectedPoint} onClose={() => select(null)} />
        ) : (
          <Overview blocks={blocks} warehouse={warehouse} stocked={stocked} onPick={(id) => select(id)} />
        )}
      </aside>
    </div>
  );
}

function LayoutBar({ warehouse, zoom, setZoom }: { warehouse: Warehouse; zoom: number; setZoom: (z: number) => void }) {
  const store = useStore.getState;
  const toast = useUi((s) => s.toast);
  const [w, setW] = useState(warehouse.width);
  const [h, setH] = useState(warehouse.height);
  const [name, setName] = useState(warehouse.name);
  const dirtySize = w !== warehouse.width || h !== warehouse.height;
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-3 py-2">
      <Field label="Layout name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => store().renameWarehouse(warehouse.id, name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-48"
        />
      </Field>
      <Field label="Grid width">
        <Input aria-label="Grid width" type="number" min={4} max={MAX_GRID} value={w} onChange={(e) => setW(Number(e.target.value))} className="w-20" />
      </Field>
      <Field label="Grid height">
        <Input aria-label="Grid height" type="number" min={4} max={MAX_GRID} value={h} onChange={(e) => setH(Number(e.target.value))} className="w-20" />
      </Field>
      <Button
        disabled={!dirtySize}
        onClick={() => {
          const err = store().resizeWarehouse(warehouse.id, w, h);
          if (err) toast(err, 'error');
          else toast(`Grid resized to ${w}×${h}.`, 'success');
        }}
      >
        Resize grid
      </Button>
      <Field label="Zoom">
        <Select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {[20, 26, 32, 40, 48].map((z) => (
            <option key={z} value={z}>
              {Math.round((z / 32) * 100)}%
            </option>
          ))}
        </Select>
      </Field>
      <div className="ml-auto flex gap-2">
        <Button
          onClick={() => {
            const n = prompt('Name of the new layout', 'New warehouse');
            if (n) store().createWarehouse(n, 24, 16);
          }}
        >
          New layout
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (confirm(`Delete layout "${warehouse.name}" with all its blocks, stock assignments, picking lists and sessions?`)) {
              store().deleteWarehouse(warehouse.id);
            }
          }}
        >
          Delete layout
        </Button>
      </div>
    </div>
  );
}

function Overview({
  warehouse,
  blocks,
  stocked,
  onPick,
}: {
  warehouse: Warehouse;
  blocks: Block[];
  stocked: Set<string>;
  onPick: (id: string) => void;
}) {
  const sorted = [...blocks].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">{warehouse.name}</h2>
      <p className="mb-4 text-sm text-slate-600">
        {warehouse.width}×{warehouse.height} grid · {blocks.length} blocks · {warehouse.points.filter((p) => p.kind === 'entrance').length} entrance(s) ·{' '}
        {warehouse.points.filter((p) => p.kind === 'exit').length} exit(s)
      </p>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500">No blocks yet. Choose “Add block” and drag on the grid.</p>
      ) : (
        <>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Blocks</h3>
          <ul className="grid grid-cols-2 gap-2">
            {sorted.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onPick(b.id)}
                  className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-indigo-400 hover:bg-indigo-50"
                >
                  <span className="font-semibold">Block {b.code}</span>
                  <span className="flex gap-1">
                    <Badge>{b.floors.length}F</Badge>
                    {stocked.has(b.id) ? <Badge tone="blue">stocked</Badge> : <Badge>empty</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PointPanel({ warehouse, point, onClose }: { warehouse: Warehouse; point: AccessPoint; onClose: () => void }) {
  const store = useStore.getState;
  const [label, setLabel] = useState(point.label);
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{point.kind === 'entrance' ? 'Entrance' : 'Exit'}</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Close panel">
          ✕
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <Field label="Label">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => store().updatePoint(warehouse.id, point.id, { label: label.trim() || point.label })}
          />
        </Field>
        <Field label="Type">
          <Select value={point.kind} onChange={(e) => store().updatePoint(warehouse.id, point.id, { kind: e.target.value as AccessPoint['kind'] })}>
            <option value="entrance">Entrance</option>
            <option value="exit">Exit</option>
          </Select>
        </Field>
        <p className="text-sm text-slate-600">
          Position: column {point.x + 1}, row {point.y + 1}. Drag the marker with the Select tool to move it.
        </p>
        <Button
          variant="danger"
          onClick={() => {
            store().removePoint(warehouse.id, point.id);
            onClose();
          }}
        >
          Remove {point.kind}
        </Button>
      </div>
    </div>
  );
}
