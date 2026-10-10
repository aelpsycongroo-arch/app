import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { autoAllocate, buildPickLines, extractRows, guessMapping, matchRow, parseQuantity, type MatchContext } from './matching';
import { createSampleData, SAMPLE_PICKING_CSV } from './sample';
import { parseCsvText, parseWorkbook } from './spreadsheet';

const data = createSampleData();
const ctx: MatchContext = { warehouseId: data.warehouse.id, products: data.products, inventory: data.inventory, blocks: data.blocks };

describe('column mapping', () => {
  it('recognises common header names', () => {
    expect(guessMapping(['SKU', 'Product Name', 'Quantity'])).toEqual({ sku: 0, name: 1, quantity: 2 });
    expect(guessMapping(['Qty', 'Item Code', 'Description'])).toEqual({ sku: 1, name: 2, quantity: 0 });
    expect(guessMapping(['foo', 'bar'])).toEqual({ sku: null, name: null, quantity: null });
  });
});

describe('quantity parsing', () => {
  it('accepts positive integers only', () => {
    expect(parseQuantity('5')).toBe(5);
    expect(parseQuantity(' 1,200 ')).toBe(1200);
    expect(parseQuantity('3.0')).toBe(3);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
    expect(parseQuantity('2.5')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });
});

describe('row matching', () => {
  const sheet = parseCsvText(SAMPLE_PICKING_CSV)[0];
  const raw = extractRows(sheet.rows, guessMapping(sheet.rows[0]), true);
  const rows = raw.map((r) => matchRow(r, undefined, ctx));
  const bySku = (sku: string) => rows.find((r) => r.raw.sku === sku)!;

  it('matches by SKU and resolves the single registered location', () => {
    const r = bySku('SN001');
    expect(r.ready).toBe(true);
    expect(r.product?.name).toBe('Sweet Snack 001');
    expect(r.locations.map((l) => l.code)).toEqual(['A-F1']);
    expect(r.allocations).toEqual([{ inventoryId: r.locations[0].inventoryId, quantity: 5 }]);
  });

  it('flags products stored in several locations instead of guessing', () => {
    const r = bySku('DR002');
    expect(r.ready).toBe(false);
    expect(r.issues).toEqual(['choose-location']);
    expect(r.locations.map((l) => l.code)).toEqual(['B-F1', 'E-F2']);
    expect(r.allocations).toEqual([]);
  });

  it('flags unknown SKUs and products without a location', () => {
    expect(bySku('XX999').issues).toContain('unmatched-product');
    expect(bySku('SP001').issues).toEqual(['no-location']);
  });

  it('applies worker corrections', () => {
    const dr = bySku('DR002');
    const fixed = matchRow(dr.raw, { allocations: [{ inventoryId: dr.locations[1].inventoryId, quantity: 12 }] }, ctx);
    expect(fixed.ready).toBe(true);
    const split = matchRow(dr.raw, { allocations: [{ inventoryId: dr.locations[0].inventoryId, quantity: 5 }] }, ctx);
    expect(split.issues).toEqual(['allocation-mismatch']);
    const cola = data.products.find((p) => p.sku === 'DR001')!;
    const manual = matchRow(bySku('XX999').raw, { productId: cola.id }, ctx);
    expect(manual.ready).toBe(true);
    expect(manual.matchedBy).toBe('manual');
    expect(matchRow(bySku('XX999').raw, { excluded: true }, ctx).ready).toBe(false);
  });

  it('suggests (but does not apply) a name match when the SKU is unknown', () => {
    const r = matchRow({ rowNumber: 2, sku: 'TYPO1', name: 'Chocolate Bar', quantityText: '1' }, undefined, ctx);
    expect(r.product).toBeNull();
    expect(r.suggestions.map((p) => p.sku)).toEqual(['SN003']);
  });

  it('matches by exact name only when there is no SKU', () => {
    const r = matchRow({ rowNumber: 2, sku: '', name: 'chocolate bar', quantityText: '2' }, undefined, ctx);
    expect(r.product?.sku).toBe('SN003');
    expect(r.matchedBy).toBe('name');
    expect(r.ready).toBe(true);
  });

  it('warns about insufficient stock but still allows picking', () => {
    const r = matchRow({ rowNumber: 2, sku: 'SN001', name: '', quantityText: '999' }, undefined, ctx);
    expect(r.ready).toBe(true);
    expect(r.warnings.join()).toMatch(/Only 50 in stock at A-F1/);
  });

  it('builds pick lines with separate block and floor ids', () => {
    const lines = buildPickLines(rows);
    expect(lines).toHaveLength(4); // SN001, SN002, SN003, CF001
    const a = data.blocks.find((b) => b.code === 'A')!;
    const sn1 = lines.find((l) => l.sku === 'SN001')!;
    expect(sn1.blockId).toBe(a.id);
    expect(sn1.floorId).toBe(a.floors[0].id);
  });
});

describe('autoAllocate', () => {
  const locs = [
    { inventoryId: '1', blockId: 'B', floorId: 'f', code: 'B-F1', available: 60 },
    { inventoryId: '2', blockId: 'E', floorId: 'g', code: 'E-F2', available: 40 },
  ];
  it('prefers a block already on the route', () => {
    expect(autoAllocate(12, locs, new Set(['E']))).toEqual([{ inventoryId: '2', quantity: 12 }]);
    expect(autoAllocate(12, locs, new Set())).toEqual([{ inventoryId: '1', quantity: 12 }]);
  });
  it('splits when one location is not enough', () => {
    expect(autoAllocate(80, locs, new Set())).toEqual([{ inventoryId: '1', quantity: 60 }, { inventoryId: '2', quantity: 20 }]);
    const over = autoAllocate(150, locs, new Set());
    expect(over.reduce((s, a) => s + a.quantity, 0)).toBe(150);
  });
});

describe('spreadsheet parsing', () => {
  it('reads xlsx workbooks as text, keeping leading zeros', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['SKU', 'Product Name', 'Quantity'], ['00123', 'Thing', 4]]);
    ws['A2'] = { t: 's', v: '00123' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Picks');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const sheets = await parseWorkbook(buf);
    expect(sheets[0].name).toBe('Picks');
    expect(sheets[0].rows).toEqual([['SKU', 'Product Name', 'Quantity'], ['00123', 'Thing', '4']]);
  });

  it('reads legacy xls workbooks', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SKU', 'Qty'], ['SN001', 5]]), 'S');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
    expect((await parseWorkbook(buf))[0].rows).toEqual([['SKU', 'Qty'], ['SN001', '5']]);
  });

  it('reads CSV with BOM, quotes and semicolons', () => {
    expect(parseCsvText('﻿SKU,Name,Qty\n"SN001","Sweet, salty",5\n\n')[0].rows).toEqual([
      ['SKU', 'Name', 'Qty'],
      ['SN001', 'Sweet, salty', '5'],
    ]);
    expect(parseCsvText('SKU;Qty\nSN001;5')[0].rows).toEqual([['SKU', 'Qty'], ['SN001', '5']]);
  });
});
