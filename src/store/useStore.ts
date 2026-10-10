import { create } from 'zustand';
import { applyChange, loadAll, replaceAll, type Change, type Snapshot, type StoreName } from '../db/db';
import { blockContains, inBounds, validateBlockRect } from '../domain/grid';
import { cellKey, newId, nextBlockCode } from '../domain/ids';
import { createEmptyWarehouse, createSampleData, makeFloors } from '../domain/sample';
import type {
  AccessPoint,
  AccessPointKind,
  Block,
  CellKind,
  GridPoint,
  InventoryRecord,
  PickList,
  PickSession,
  Product,
  RoutePlan,
  Settings,
  Warehouse,
} from '../domain/types';

export const DEFAULT_SETTINGS: Settings = { id: 'settings', activeWarehouseId: null, cellSizeMeters: 1, aisleOnly: false };
export const MAX_GRID = 120;

type SaveState = 'saved' | 'saving' | 'error';
type Result = string | null;

/* ------------------------------------------------------------------ */
/* Write-behind persistence: coalesces writes per record, flushes in   */
/* one IndexedDB transaction, keeps writes ordered.                    */
/* ------------------------------------------------------------------ */

const pending = new Map<string, { store: StoreName; key: string; value: unknown | null }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

function queue(store: StoreName, key: string, value: unknown | null) {
  pending.set(`${store}/${key}`, { store, key, value });
  useStore.setState({ saveState: 'saving' });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 150);
}

export function flush(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!pending.size) return chain;
  const change: Change = { put: {}, del: {} };
  for (const { store, key, value } of pending.values()) {
    if (value === null) (change.del![store] ??= []).push(key);
    else ((change.put![store] ??= []) as unknown[]).push(value);
  }
  pending.clear();
  chain = chain
    .then(() => applyChange(change))
    .then(() => {
      if (!pending.size) useStore.setState({ saveState: 'saved' });
    })
    .catch((err) => {
      console.error('Failed to save', err);
      useStore.setState({ saveState: 'error' });
    });
  return chain;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

const put = <T extends { id: string }>(store: StoreName, v: T) => queue(store, v.id, v);
const del = (store: StoreName, id: string) => queue(store, id, null);

/* ------------------------------------------------------------------ */

export interface AppState {
  loaded: boolean;
  saveState: SaveState;
  warehouses: Warehouse[];
  blocks: Block[];
  products: Product[];
  inventory: InventoryRecord[];
  pickLists: PickList[];
  sessions: PickSession[];
  settings: Settings;

  init(): Promise<void>;
  updateSettings(patch: Partial<Omit<Settings, 'id'>>): void;

  loadSample(): string;
  createWarehouse(name: string, width: number, height: number): string;
  renameWarehouse(id: string, name: string): void;
  resizeWarehouse(id: string, width: number, height: number): Result;
  deleteWarehouse(id: string): void;
  paintCells(warehouseId: string, cells: GridPoint[], kind: CellKind | null): void;

  addPoint(warehouseId: string, kind: AccessPointKind, at: GridPoint): Result;
  updatePoint(warehouseId: string, pointId: string, patch: Partial<Omit<AccessPoint, 'id'>>): Result;
  removePoint(warehouseId: string, pointId: string): void;

  addBlock(warehouseId: string, rect: { x: number; y: number; w: number; h: number }): { block?: Block; error?: string };
  updateBlock(id: string, patch: Partial<Pick<Block, 'code' | 'x' | 'y' | 'w' | 'h'>>): Result;
  deleteBlock(id: string): void;
  addFloor(blockId: string): void;
  removeFloor(blockId: string, floorId: string): void;
  renameFloor(blockId: string, floorId: string, name: string): void;

  saveProduct(p: Omit<Product, 'id'> & { id?: string }): { product?: Product; error?: string };
  deleteProduct(id: string): void;
  assignStock(productId: string, blockId: string, floorId: string, quantity: number): Result;
  setStockQuantity(inventoryId: string, quantity: number): Result;
  removeStock(inventoryId: string): void;

  savePickList(list: PickList): void;
  deletePickList(id: string): void;
  startSession(pickList: PickList, route: RoutePlan): string;
  updateSession(id: string, patch: Partial<Omit<PickSession, 'id'>>): void;
  deleteSession(id: string): void;

  exportSnapshot(): Snapshot;
  importSnapshot(s: Snapshot): Promise<void>;
  clearAll(): Promise<void>;
}

const norm = (s: string) => s.trim().toLowerCase();

export const useStore = create<AppState>()((set, get) => {
  const touchWarehouse = (id: string, fn: (w: Warehouse) => Warehouse | null): Result => {
    const w = get().warehouses.find((x) => x.id === id);
    if (!w) return 'Warehouse not found.';
    const next = fn(w);
    if (!next) return null;
    const updated = { ...next, updatedAt: Date.now() };
    set({ warehouses: get().warehouses.map((x) => (x.id === id ? updated : x)) });
    put('warehouses', updated);
    return null;
  };

  const writeBlock = (b: Block) => {
    set({ blocks: get().blocks.map((x) => (x.id === b.id ? b : x)) });
    put('blocks', b);
    touchWarehouse(b.warehouseId, (w) => w);
  };

  const dropInventory = (pred: (r: InventoryRecord) => boolean) => {
    const gone = get().inventory.filter(pred);
    if (!gone.length) return;
    set({ inventory: get().inventory.filter((r) => !pred(r)) });
    gone.forEach((r) => del('inventory', r.id));
  };

  const pointError = (w: Warehouse, at: GridPoint, ignoreId?: string): Result => {
    if (!inBounds(w.width, w.height, at.x, at.y)) return 'Point must be inside the grid.';
    if (w.cells[cellKey(at.x, at.y)] === 'wall') return 'Cannot place on a wall.';
    const blk = get().blocks.find((b) => b.warehouseId === w.id && blockContains(b, at.x, at.y));
    if (blk) return `Cannot place on block ${blk.code}.`;
    if (w.points.some((p) => p.id !== ignoreId && p.x === at.x && p.y === at.y)) return 'Another point is already there.';
    return null;
  };

  return {
    loaded: false,
    saveState: 'saved',
    warehouses: [],
    blocks: [],
    products: [],
    inventory: [],
    pickLists: [],
    sessions: [],
    settings: DEFAULT_SETTINGS,

    async init() {
      const s = await loadAll();
      const settings = { ...DEFAULT_SETTINGS, ...s.settings };
      if (!s.warehouses.some((w) => w.id === settings.activeWarehouseId)) {
        settings.activeWarehouseId = s.warehouses[0]?.id ?? null;
      }
      set({ ...s, settings, loaded: true });
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      put('settings', settings);
    },

    loadSample() {
      const data = createSampleData();
      const existing = new Map(get().products.map((p) => [norm(p.sku), p]));
      const newProducts: Product[] = [];
      const idMap = new Map<string, string>();
      for (const p of data.products) {
        const found = existing.get(norm(p.sku));
        if (found) idMap.set(p.id, found.id);
        else newProducts.push(p);
      }
      const inventory = data.inventory.map((r) => ({ ...r, productId: idMap.get(r.productId) ?? r.productId }));
      set({
        warehouses: [...get().warehouses, data.warehouse],
        blocks: [...get().blocks, ...data.blocks],
        products: [...get().products, ...newProducts],
        inventory: [...get().inventory, ...inventory],
      });
      put('warehouses', data.warehouse);
      data.blocks.forEach((b) => put('blocks', b));
      newProducts.forEach((p) => put('products', p));
      inventory.forEach((r) => put('inventory', r));
      get().updateSettings({ activeWarehouseId: data.warehouse.id });
      return data.warehouse.id;
    },

    createWarehouse(name, width, height) {
      const w = createEmptyWarehouse(name.trim() || 'Warehouse', clampGrid(width), clampGrid(height));
      set({ warehouses: [...get().warehouses, w] });
      put('warehouses', w);
      get().updateSettings({ activeWarehouseId: w.id });
      return w.id;
    },

    renameWarehouse(id, name) {
      touchWarehouse(id, (w) => ({ ...w, name: name.trim() || w.name }));
    },

    resizeWarehouse(id, width, height) {
      const w = get().warehouses.find((x) => x.id === id);
      if (!w) return 'Warehouse not found.';
      if (width < 4 || height < 4 || width > MAX_GRID || height > MAX_GRID) return `Grid size must be between 4 and ${MAX_GRID}.`;
      const outside = get().blocks.find((b) => b.warehouseId === id && (b.x + b.w > width || b.y + b.h > height));
      if (outside) return `Block ${outside.code} would be outside the new grid. Move it first.`;
      const pt = w.points.find((p) => p.x >= width || p.y >= height);
      if (pt) return `"${pt.label}" would be outside the new grid. Move it first.`;
      const cells: Warehouse['cells'] = {};
      for (const [k, v] of Object.entries(w.cells)) {
        const [x, y] = k.split(',').map(Number);
        if (x < width && y < height) cells[k] = v;
      }
      return touchWarehouse(id, () => ({ ...w, width, height, cells }));
    },

    deleteWarehouse(id) {
      const blockIds = new Set(get().blocks.filter((b) => b.warehouseId === id).map((b) => b.id));
      const lists = get().pickLists.filter((l) => l.warehouseId === id);
      const sessions = get().sessions.filter((s) => s.warehouseId === id);
      dropInventory((r) => r.warehouseId === id || blockIds.has(r.blockId));
      set({
        warehouses: get().warehouses.filter((w) => w.id !== id),
        blocks: get().blocks.filter((b) => !blockIds.has(b.id)),
        pickLists: get().pickLists.filter((l) => l.warehouseId !== id),
        sessions: get().sessions.filter((s) => s.warehouseId !== id),
      });
      del('warehouses', id);
      blockIds.forEach((b) => del('blocks', b));
      lists.forEach((l) => del('pickLists', l.id));
      sessions.forEach((s) => del('sessions', s.id));
      if (get().settings.activeWarehouseId === id) {
        get().updateSettings({ activeWarehouseId: get().warehouses[0]?.id ?? null });
      }
    },

    paintCells(warehouseId, points, kind) {
      const blocks = get().blocks.filter((b) => b.warehouseId === warehouseId);
      touchWarehouse(warehouseId, (w) => {
        const cells = { ...w.cells };
        let changed = false;
        for (const { x, y } of points) {
          if (!inBounds(w.width, w.height, x, y)) continue;
          const k = cellKey(x, y);
          if (kind === null) {
            if (k in cells) {
              delete cells[k];
              changed = true;
            }
            continue;
          }
          if (blocks.some((b) => blockContains(b, x, y))) continue;
          if (kind === 'wall' && w.points.some((p) => p.x === x && p.y === y)) continue;
          if (cells[k] !== kind) {
            cells[k] = kind;
            changed = true;
          }
        }
        return changed ? { ...w, cells } : null;
      });
    },

    addPoint(warehouseId, kind, at) {
      const w = get().warehouses.find((x) => x.id === warehouseId);
      if (!w) return 'Warehouse not found.';
      const err = pointError(w, at);
      if (err) return err;
      const n = w.points.filter((p) => p.kind === kind).length + 1;
      const label = kind === 'entrance' ? `Entrance ${n}` : `Exit ${n}`;
      return touchWarehouse(warehouseId, () => ({ ...w, points: [...w.points, { id: newId(), kind, label, x: at.x, y: at.y }] }));
    },

    updatePoint(warehouseId, pointId, patch) {
      const w = get().warehouses.find((x) => x.id === warehouseId);
      const p = w?.points.find((x) => x.id === pointId);
      if (!w || !p) return 'Point not found.';
      const next = { ...p, ...patch };
      if (patch.x !== undefined || patch.y !== undefined) {
        const err = pointError(w, next, p.id);
        if (err) return err;
      }
      return touchWarehouse(warehouseId, () => ({ ...w, points: w.points.map((x) => (x.id === pointId ? next : x)) }));
    },

    removePoint(warehouseId, pointId) {
      touchWarehouse(warehouseId, (w) => ({ ...w, points: w.points.filter((p) => p.id !== pointId) }));
    },

    addBlock(warehouseId, rect) {
      const w = get().warehouses.find((x) => x.id === warehouseId);
      if (!w) return { error: 'Warehouse not found.' };
      const others = get().blocks.filter((b) => b.warehouseId === warehouseId);
      const error = validateBlockRect(w, others, rect);
      if (error) return { error };
      const block: Block = {
        id: newId(),
        warehouseId,
        code: nextBlockCode(others.map((b) => b.code)),
        ...rect,
        floors: makeFloors(3),
      };
      set({ blocks: [...get().blocks, block] });
      put('blocks', block);
      touchWarehouse(warehouseId, (x) => x);
      return { block };
    },

    updateBlock(id, patch) {
      const b = get().blocks.find((x) => x.id === id);
      if (!b) return 'Block not found.';
      const next = { ...b, ...patch };
      if (patch.code !== undefined) {
        const code = patch.code.trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9-]{0,7}$/.test(code)) return 'Block ID must be 1–8 letters/digits (e.g. A, B2, A01).';
        if (get().blocks.some((x) => x.id !== id && x.warehouseId === b.warehouseId && x.code === code)) {
          return `Block ID ${code} is already used.`;
        }
        next.code = code;
      }
      if (['x', 'y', 'w', 'h'].some((k) => k in patch)) {
        const w = get().warehouses.find((x) => x.id === b.warehouseId)!;
        const err = validateBlockRect(w, get().blocks, next, id);
        if (err) return err;
      }
      writeBlock(next);
      return null;
    },

    deleteBlock(id) {
      const b = get().blocks.find((x) => x.id === id);
      if (!b) return;
      dropInventory((r) => r.blockId === id);
      set({ blocks: get().blocks.filter((x) => x.id !== id) });
      del('blocks', id);
      touchWarehouse(b.warehouseId, (w) => w);
    },

    addFloor(blockId) {
      const b = get().blocks.find((x) => x.id === blockId);
      if (!b) return;
      const level = Math.max(0, ...b.floors.map((f) => f.level)) + 1;
      writeBlock({ ...b, floors: [...b.floors, { id: newId(), level, name: `Floor ${level}` }] });
    },

    removeFloor(blockId, floorId) {
      const b = get().blocks.find((x) => x.id === blockId);
      if (!b) return;
      dropInventory((r) => r.blockId === blockId && r.floorId === floorId);
      writeBlock({ ...b, floors: b.floors.filter((f) => f.id !== floorId) });
    },

    renameFloor(blockId, floorId, name) {
      const b = get().blocks.find((x) => x.id === blockId);
      if (!b) return;
      writeBlock({ ...b, floors: b.floors.map((f) => (f.id === floorId ? { ...f, name: name.trim() || `Floor ${f.level}` } : f)) });
    },

    saveProduct(input) {
      const sku = input.sku.trim();
      const name = input.name.trim();
      if (!sku) return { error: 'SKU is required.' };
      if (!name) return { error: 'Product name is required.' };
      const dup = get().products.find((p) => p.id !== input.id && norm(p.sku) === norm(sku));
      if (dup) return { error: `SKU ${sku} already belongs to "${dup.name}".` };
      const product: Product = {
        id: input.id ?? newId(),
        sku,
        barcode: input.barcode.trim(),
        name,
        category: input.category.trim(),
      };
      const exists = get().products.some((p) => p.id === product.id);
      set({ products: exists ? get().products.map((p) => (p.id === product.id ? product : p)) : [...get().products, product] });
      put('products', product);
      return { product };
    },

    deleteProduct(id) {
      dropInventory((r) => r.productId === id);
      set({ products: get().products.filter((p) => p.id !== id) });
      del('products', id);
    },

    assignStock(productId, blockId, floorId, quantity) {
      if (!Number.isInteger(quantity) || quantity < 0) return 'Quantity must be a whole number ≥ 0.';
      const block = get().blocks.find((b) => b.id === blockId);
      if (!block || !block.floors.some((f) => f.id === floorId)) return 'Choose a valid block and floor.';
      if (!get().products.some((p) => p.id === productId)) return 'Choose a product.';
      const existing = get().inventory.find((r) => r.productId === productId && r.blockId === blockId && r.floorId === floorId);
      const record: InventoryRecord = existing
        ? { ...existing, quantity: existing.quantity + quantity }
        : { id: newId(), productId, warehouseId: block.warehouseId, blockId, floorId, quantity };
      set({ inventory: existing ? get().inventory.map((r) => (r.id === record.id ? record : r)) : [...get().inventory, record] });
      put('inventory', record);
      return null;
    },

    setStockQuantity(inventoryId, quantity) {
      if (!Number.isInteger(quantity) || quantity < 0) return 'Quantity must be a whole number ≥ 0.';
      const r = get().inventory.find((x) => x.id === inventoryId);
      if (!r) return 'Record not found.';
      const next = { ...r, quantity };
      set({ inventory: get().inventory.map((x) => (x.id === inventoryId ? next : x)) });
      put('inventory', next);
      return null;
    },

    removeStock(inventoryId) {
      dropInventory((r) => r.id === inventoryId);
    },

    savePickList(list) {
      set({ pickLists: [...get().pickLists.filter((l) => l.id !== list.id), list] });
      put('pickLists', list);
    },

    deletePickList(id) {
      set({ pickLists: get().pickLists.filter((l) => l.id !== id) });
      del('pickLists', id);
    },

    startSession(pickList, route) {
      const itemStatus: PickSession['itemStatus'] = {};
      route.stops.forEach((s) => s.picks.forEach((p) => (itemStatus[p.lineId] = 'pending')));
      const now = Date.now();
      const session: PickSession = {
        id: newId(),
        warehouseId: pickList.warehouseId,
        pickListId: pickList.id,
        name: pickList.name,
        route,
        itemStatus,
        currentStop: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      set({ sessions: [...get().sessions, session] });
      put('sessions', session);
      return session.id;
    },

    updateSession(id, patch) {
      const s = get().sessions.find((x) => x.id === id);
      if (!s) return;
      const next = { ...s, ...patch, updatedAt: Date.now() };
      set({ sessions: get().sessions.map((x) => (x.id === id ? next : x)) });
      put('sessions', next);
    },

    deleteSession(id) {
      set({ sessions: get().sessions.filter((s) => s.id !== id) });
      del('sessions', id);
    },

    exportSnapshot() {
      const { warehouses, blocks, products, inventory, pickLists, sessions, settings } = get();
      return { warehouses, blocks, products, inventory, pickLists, sessions, settings };
    },

    async importSnapshot(s) {
      await flush();
      await replaceAll(s);
      await get().init();
    },

    async clearAll() {
      await flush();
      await replaceAll({ warehouses: [], blocks: [], products: [], inventory: [], pickLists: [], sessions: [], settings: DEFAULT_SETTINGS });
      await get().init();
    },
  };
});

function clampGrid(n: number) {
  return Math.max(4, Math.min(MAX_GRID, Math.round(n) || 4));
}

/* ---------------------------- selectors ----------------------------- */

export function useActiveWarehouse(): Warehouse | null {
  return useStore((s) => s.warehouses.find((w) => w.id === s.settings.activeWarehouseId) ?? null);
}
