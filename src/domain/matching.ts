import { locationCode } from './location';
import type { Block, InventoryRecord, PickLine, Product } from './types';
import { newId } from './ids';

export interface ColumnMapping {
  sku: number | null;
  name: number | null;
  quantity: number | null;
}

const SYNONYMS: Record<keyof ColumnMapping, string[]> = {
  sku: ['sku', 'skucode', 'itemcode', 'productcode', 'code', 'barcode', 'ean', 'upc', 'article', 'articleno', 'itemno', 'partno', 'partnumber'],
  name: ['productname', 'name', 'product', 'itemname', 'item', 'description', 'itemdescription', 'title'],
  quantity: ['quantity', 'qty', 'requestedquantity', 'requestedqty', 'orderqty', 'pickqty', 'amount', 'count', 'pcs', 'units'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Suggests a column mapping from header names. The worker confirms it in the UI. */
export function guessMapping(headers: string[]): ColumnMapping {
  const result: ColumnMapping = { sku: null, name: null, quantity: null };
  const used = new Set<number>();
  for (const field of ['quantity', 'sku', 'name'] as const) {
    let best: { idx: number; rank: number } | null = null;
    headers.forEach((h, idx) => {
      if (used.has(idx)) return;
      const rank = SYNONYMS[field].indexOf(norm(h));
      if (rank >= 0 && (!best || rank < best.rank)) best = { idx, rank };
    });
    if (best) {
      result[field] = (best as { idx: number }).idx;
      used.add((best as { idx: number }).idx);
    }
  }
  return result;
}

export interface RawPickRow {
  /** 1-based row number in the spreadsheet, for error messages. */
  rowNumber: number;
  sku: string;
  name: string;
  quantityText: string;
}

export function extractRows(rows: string[][], mapping: ColumnMapping, hasHeader: boolean): RawPickRow[] {
  const out: RawPickRow[] = [];
  const cell = (r: string[], i: number | null) => (i === null ? '' : String(r[i] ?? '').trim());
  rows.forEach((r, i) => {
    if (hasHeader && i === 0) return;
    const row = { rowNumber: i + 1, sku: cell(r, mapping.sku), name: cell(r, mapping.name), quantityText: cell(r, mapping.quantity) };
    if (!row.sku && !row.name && !row.quantityText) return;
    out.push(row);
  });
  return out;
}

export function parseQuantity(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '');
  if (!/^\d+(\.0+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export interface LocationOption {
  inventoryId: string;
  blockId: string;
  floorId: string;
  code: string;
  available: number;
}

export interface Allocation {
  inventoryId: string;
  quantity: number;
}

/** Corrections the worker made to a single row. */
export interface RowOverride {
  productId?: string;
  quantity?: number;
  allocations?: Allocation[];
  excluded?: boolean;
}

export type RowIssue =
  | 'unmatched-product'
  | 'ambiguous-product'
  | 'invalid-quantity'
  | 'no-location'
  | 'choose-location'
  | 'allocation-mismatch';

export const ISSUE_TEXT: Record<RowIssue, string> = {
  'unmatched-product': 'Product not found in inventory',
  'ambiguous-product': 'Several products match this name',
  'invalid-quantity': 'Quantity is missing or not a positive whole number',
  'no-location': 'Product has no registered block/floor location',
  'choose-location': 'Product is stored in several locations — choose where to pick',
  'allocation-mismatch': 'Allocated quantity does not equal requested quantity',
};

export interface MatchedRow {
  raw: RawPickRow;
  quantity: number | null;
  product: Product | null;
  matchedBy: 'sku' | 'barcode' | 'name' | 'manual' | null;
  /** Possible products the worker can confirm (never auto-applied when SKU is given). */
  suggestions: Product[];
  locations: LocationOption[];
  allocations: Allocation[];
  issues: RowIssue[];
  warnings: string[];
  excluded: boolean;
  ready: boolean;
}

export interface MatchContext {
  warehouseId: string;
  products: Product[];
  inventory: InventoryRecord[];
  blocks: Block[];
}

export function locationOptions(productId: string, ctx: MatchContext): LocationOption[] {
  const out: LocationOption[] = [];
  for (const inv of ctx.inventory) {
    if (inv.productId !== productId || inv.warehouseId !== ctx.warehouseId) continue;
    const block = ctx.blocks.find((b) => b.id === inv.blockId);
    const floor = block?.floors.find((f) => f.id === inv.floorId);
    if (!block || !floor) continue;
    out.push({ inventoryId: inv.id, blockId: block.id, floorId: floor.id, code: locationCode(block, floor), available: inv.quantity });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function matchRow(raw: RawPickRow, override: RowOverride | undefined, ctx: MatchContext): MatchedRow {
  const issues: RowIssue[] = [];
  const warnings: string[] = [];
  const quantity = override?.quantity ?? parseQuantity(raw.quantityText);
  if (quantity === null) issues.push('invalid-quantity');

  let product: Product | null = null;
  let matchedBy: MatchedRow['matchedBy'] = null;
  let suggestions: Product[] = [];
  const byName = raw.name ? ctx.products.filter((p) => sameText(p.name, raw.name)) : [];

  if (override?.productId) {
    product = ctx.products.find((p) => p.id === override.productId) ?? null;
    matchedBy = product ? 'manual' : null;
  } else if (raw.sku) {
    product = ctx.products.find((p) => sameText(p.sku, raw.sku)) ?? null;
    matchedBy = product ? 'sku' : null;
    if (!product) {
      product = ctx.products.find((p) => p.barcode && sameText(p.barcode, raw.sku)) ?? null;
      matchedBy = product ? 'barcode' : null;
    }
    if (!product) suggestions = byName;
  } else if (byName.length === 1) {
    product = byName[0];
    matchedBy = 'name';
    warnings.push('Matched by exact product name (no SKU in file).');
  } else if (byName.length > 1) {
    suggestions = byName;
  }

  if (!product) issues.push(suggestions.length > 1 && !raw.sku ? 'ambiguous-product' : 'unmatched-product');
  else if (raw.name && (matchedBy === 'sku' || matchedBy === 'barcode') && !sameText(product.name, raw.name)) {
    warnings.push(`File name "${raw.name}" differs from registered name "${product.name}".`);
  }

  const locations = product ? locationOptions(product.id, ctx) : [];
  let allocations: Allocation[] = [];
  if (product) {
    if (locations.length === 0) issues.push('no-location');
    else if (override?.allocations?.length) {
      allocations = override.allocations.filter((a) => locations.some((l) => l.inventoryId === a.inventoryId) && a.quantity > 0);
      if (!allocations.length) issues.push('choose-location');
    } else if (locations.length === 1 && quantity !== null) {
      allocations = [{ inventoryId: locations[0].inventoryId, quantity }];
    } else if (locations.length > 1) issues.push('choose-location');
  }
  if (quantity !== null && allocations.length) {
    const sum = allocations.reduce((s, a) => s + a.quantity, 0);
    if (sum !== quantity) issues.push('allocation-mismatch');
    for (const a of allocations) {
      const loc = locations.find((l) => l.inventoryId === a.inventoryId)!;
      if (a.quantity > loc.available) warnings.push(`Only ${loc.available} in stock at ${loc.code} (need ${a.quantity}).`);
    }
  }

  const excluded = !!override?.excluded;
  return {
    raw,
    quantity,
    product,
    matchedBy,
    suggestions,
    locations,
    allocations,
    issues,
    warnings,
    excluded,
    ready: !excluded && issues.length === 0,
  };
}

/**
 * Explicit, worker-triggered helper: fills `quantity` from known stock,
 * preferring locations in blocks already being visited, then the fullest
 * location. It only chooses among registered locations of the product.
 */
export function autoAllocate(quantity: number, locations: LocationOption[], preferredBlockIds: Set<string>): Allocation[] {
  const sorted = [...locations].sort(
    (a, b) =>
      Number(preferredBlockIds.has(b.blockId)) - Number(preferredBlockIds.has(a.blockId)) ||
      Number(b.available >= quantity) - Number(a.available >= quantity) ||
      b.available - a.available,
  );
  if (sorted[0] && sorted[0].available >= quantity) return [{ inventoryId: sorted[0].inventoryId, quantity }];
  const out: Allocation[] = [];
  let left = quantity;
  for (const loc of [...locations].sort((a, b) => b.available - a.available)) {
    if (left <= 0) break;
    const take = Math.min(left, loc.available);
    if (take > 0) {
      out.push({ inventoryId: loc.inventoryId, quantity: take });
      left -= take;
    }
  }
  // Not enough stock anywhere: put the remainder on the fullest location so the
  // total still matches; the UI shows a stock warning for it.
  if (left > 0 && locations.length) {
    const target = out[0]?.inventoryId ?? locations[0].inventoryId;
    const existing = out.find((a) => a.inventoryId === target);
    if (existing) existing.quantity += left;
    else out.push({ inventoryId: target, quantity: left });
  }
  return out;
}

export function buildPickLines(rows: MatchedRow[]): PickLine[] {
  const lines: PickLine[] = [];
  for (const row of rows) {
    if (!row.ready || !row.product) continue;
    for (const a of row.allocations) {
      const loc = row.locations.find((l) => l.inventoryId === a.inventoryId)!;
      lines.push({
        id: newId(),
        productId: row.product.id,
        sku: row.product.sku,
        productName: row.product.name,
        quantity: a.quantity,
        blockId: loc.blockId,
        floorId: loc.floorId,
      });
    }
  }
  return lines;
}
