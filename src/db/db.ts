import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Block, InventoryRecord, PickList, PickSession, Product, Settings, Warehouse } from '../domain/types';

export interface WarehouseDB extends DBSchema {
  warehouses: { key: string; value: Warehouse };
  blocks: { key: string; value: Block; indexes: { warehouseId: string } };
  products: { key: string; value: Product; indexes: { sku: string } };
  inventory: { key: string; value: InventoryRecord; indexes: { productId: string; blockId: string } };
  pickLists: { key: string; value: PickList };
  sessions: { key: string; value: PickSession };
  settings: { key: string; value: Settings };
}

export type StoreName = 'warehouses' | 'blocks' | 'products' | 'inventory' | 'pickLists' | 'sessions' | 'settings';
export const STORE_NAMES: StoreName[] = ['warehouses', 'blocks', 'products', 'inventory', 'pickLists', 'sessions', 'settings'];

export const DB_NAME = 'warehouse-blueprint';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<WarehouseDB>> | null = null;

export function getDB() {
  dbPromise ??= openDB<WarehouseDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('warehouses', { keyPath: 'id' });
      db.createObjectStore('blocks', { keyPath: 'id' }).createIndex('warehouseId', 'warehouseId');
      db.createObjectStore('products', { keyPath: 'id' }).createIndex('sku', 'sku');
      const inv = db.createObjectStore('inventory', { keyPath: 'id' });
      inv.createIndex('productId', 'productId');
      inv.createIndex('blockId', 'blockId');
      db.createObjectStore('pickLists', { keyPath: 'id' });
      db.createObjectStore('sessions', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export interface Snapshot {
  warehouses: Warehouse[];
  blocks: Block[];
  products: Product[];
  inventory: InventoryRecord[];
  pickLists: PickList[];
  sessions: PickSession[];
  settings: Settings | undefined;
}

export async function loadAll(): Promise<Snapshot> {
  const db = await getDB();
  const [warehouses, blocks, products, inventory, pickLists, sessions, settings] = await Promise.all([
    db.getAll('warehouses'),
    db.getAll('blocks'),
    db.getAll('products'),
    db.getAll('inventory'),
    db.getAll('pickLists'),
    db.getAll('sessions'),
    db.get('settings', 'settings'),
  ]);
  return { warehouses, blocks, products, inventory, pickLists, sessions, settings };
}

/** A batch of puts and deletes applied in one transaction. */
export interface Change {
  put?: Partial<{ [K in StoreName]: WarehouseDB[K]['value'][] }>;
  del?: Partial<Record<StoreName, string[]>>;
}

export async function applyChange(change: Change) {
  const db = await getDB();
  const stores = [...new Set([...Object.keys(change.put ?? {}), ...Object.keys(change.del ?? {})])] as StoreName[];
  if (!stores.length) return;
  const tx = db.transaction(stores, 'readwrite');
  const ops: Promise<unknown>[] = [];
  for (const [store, values] of Object.entries(change.put ?? {})) {
    for (const v of values as unknown[]) ops.push(tx.objectStore(store as StoreName).put(v as never));
  }
  for (const [store, keys] of Object.entries(change.del ?? {})) {
    for (const k of keys) ops.push(tx.objectStore(store as StoreName).delete(k));
  }
  await Promise.all([...ops, tx.done]);
}

export async function replaceAll(snapshot: Snapshot) {
  const db = await getDB();
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  await Promise.all(STORE_NAMES.map((s) => tx.objectStore(s).clear()));
  const ops: Promise<unknown>[] = [];
  for (const s of STORE_NAMES) {
    if (s === 'settings') continue;
    for (const v of snapshot[s] as unknown[]) ops.push(tx.objectStore(s).put(v as never));
  }
  if (snapshot.settings) ops.push(tx.objectStore('settings').put(snapshot.settings));
  await Promise.all([...ops, tx.done]);
}
