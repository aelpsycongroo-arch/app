import { cellKey, newId } from './ids';
import type { Block, CellKind, Floor, InventoryRecord, Product, Warehouse } from './types';

export const SAMPLE_PICKING_CSV = `SKU,Product Name,Quantity
SN001,Sweet Snack 001,5
SN002,Spicy Snack 002,3
SN003,Chocolate Bar,10
DR002,Orange Juice 1L,12
CF001,Ground Coffee 250g,4
XX999,Unknown Product,2
SP001,Paprika Powder,1
`;

export function makeFloors(count: number): Floor[] {
  return Array.from({ length: count }, (_, i) => ({ id: newId(), level: i + 1, name: `Floor ${i + 1}` }));
}

export function createEmptyWarehouse(name: string, width: number, height: number): Warehouse {
  const now = Date.now();
  return {
    id: newId(),
    name,
    width,
    height,
    cells: {},
    points: [
      { id: newId(), kind: 'entrance', label: 'Entrance', x: 0, y: height - 1 },
      { id: newId(), kind: 'exit', label: 'Exit', x: width - 1, y: height - 1 },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/** A 24×16 demo warehouse with 7 blocks, aisles, a wall and 15 products. */
export function createSampleData() {
  const warehouse = createEmptyWarehouse('Sample Warehouse', 24, 16);
  warehouse.name = 'Sample Warehouse';
  const paint = (x0: number, y0: number, x1: number, y1: number, kind: CellKind) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) warehouse.cells[cellKey(x, y)] = kind;
  };
  for (const y of [1, 5, 10, 14]) paint(0, y, 23, y, 'aisle');
  for (const x of [1, 7, 13, 19]) paint(x, 1, x, 14, 'aisle');
  paint(2, 12, 11, 12, 'wall');
  warehouse.points = [
    { id: newId(), kind: 'entrance', label: 'Main entrance', x: 0, y: 14 },
    { id: newId(), kind: 'entrance', label: 'Side door', x: 23, y: 1 },
    { id: newId(), kind: 'exit', label: 'Dispatch', x: 23, y: 14 },
  ];

  const mk = (code: string, x: number, y: number, w: number, h: number, floors: number): Block => ({
    id: newId(),
    warehouseId: warehouse.id,
    code,
    x,
    y,
    w,
    h,
    floors: makeFloors(floors),
  });
  const blocks = [
    mk('A', 2, 2, 4, 2, 4),
    mk('B', 8, 2, 4, 2, 3),
    mk('C', 14, 2, 4, 2, 3),
    mk('D', 2, 7, 4, 2, 3),
    mk('E', 8, 7, 4, 2, 3),
    mk('F', 14, 7, 4, 2, 3),
    mk('G', 20, 3, 2, 6, 2),
  ];
  const byCode = Object.fromEntries(blocks.map((b) => [b.code, b]));

  const products: Product[] = [];
  const inventory: InventoryRecord[] = [];
  const add = (sku: string, name: string, category: string, locs: [string, number, number][]) => {
    const p: Product = { id: newId(), sku, barcode: '', name, category };
    products.push(p);
    for (const [code, level, quantity] of locs) {
      const block = byCode[code];
      const floor = block.floors.find((f) => f.level === level)!;
      inventory.push({ id: newId(), productId: p.id, warehouseId: warehouse.id, blockId: block.id, floorId: floor.id, quantity });
    }
  };
  add('SN001', 'Sweet Snack 001', 'Sweet Snacks', [['A', 1, 50]]);
  add('SN002', 'Spicy Snack 002', 'Spicy Snacks', [['A', 2, 30]]);
  add('CH004', 'Dark Chocolate 70%', 'Chocolate', [['A', 3, 25]]);
  add('SN003', 'Chocolate Bar', 'Chocolate', [['C', 3, 40]]);
  add('DR001', 'Cola 330ml', 'Drinks', [['B', 1, 120]]);
  add('DR002', 'Orange Juice 1L', 'Drinks', [['B', 1, 60], ['E', 2, 40]]);
  add('NO001', 'Instant Noodles Chicken', 'Instant Noodles', [['B', 2, 200]]);
  add('NO002', 'Instant Noodles Beef', 'Instant Noodles', [['B', 2, 150]]);
  add('BS001', 'Butter Cookies', 'Biscuits', [['D', 1, 80]]);
  add('BS002', 'Crackers', 'Biscuits', [['D', 2, 70]]);
  add('TE001', 'Green Tea 20 bags', 'Tea', [['F', 2, 45]]);
  add('CF001', 'Ground Coffee 250g', 'Coffee', [['F', 3, 35]]);
  add('RC001', 'Jasmine Rice 5kg', 'Rice', [['G', 1, 20]]);
  add('OL001', 'Sunflower Oil 1L', 'Cooking Oil', [['G', 2, 30]]);
  add('SP001', 'Paprika Powder', 'Spices', []);

  return { warehouse, blocks, products, inventory };
}
