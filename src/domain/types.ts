/** Painted cell kinds. Cells without an entry are open floor (walkable). */
export type CellKind = 'aisle' | 'wall';

export interface GridPoint {
  x: number;
  y: number;
}

export type AccessPointKind = 'entrance' | 'exit';

export interface AccessPoint extends GridPoint {
  id: string;
  kind: AccessPointKind;
  label: string;
}

export interface Warehouse {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Sparse map keyed by `${x},${y}`. */
  cells: Record<string, CellKind>;
  points: AccessPoint[];
  createdAt: number;
  updatedAt: number;
}

export interface Floor {
  id: string;
  /** Vertical position, 1 = ground level. Used in the location code (A-F1). */
  level: number;
  name: string;
}

export interface Block extends GridPoint {
  id: string;
  warehouseId: string;
  /** Human-facing identifier shown on the blueprint, e.g. "A" or "A01". */
  code: string;
  w: number;
  h: number;
  floors: Floor[];
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
}

/** Stock of one product at one exact storage location (block + floor). */
export interface InventoryRecord {
  id: string;
  productId: string;
  warehouseId: string;
  blockId: string;
  floorId: string;
  quantity: number;
}

export interface PickLine {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  blockId: string;
  floorId: string;
}

export interface PickList {
  id: string;
  warehouseId: string;
  name: string;
  sourceFileName: string;
  createdAt: number;
  lines: PickLine[];
}

export interface StopPick {
  lineId: string;
  floorId: string;
  floorLevel: number;
  floorName: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
}

export interface RouteStop {
  blockId: string;
  blockCode: string;
  /** Walkable cell next to the block where the worker stands to pick. */
  accessCell: GridPoint;
  /** Walking path from the previous stop (or the start point) to accessCell. */
  path: GridPoint[];
  /** Walking distance of this leg in grid cells. */
  distance: number;
  /** Floor-level picking instructions, sorted by floor level. */
  picks: StopPick[];
}

export interface RoutePlan {
  start: GridPoint;
  end: GridPoint;
  stops: RouteStop[];
  finalLeg: { path: GridPoint[]; distance: number };
  /** Total walking distance in grid cells. */
  totalDistance: number;
  /** Blocks that have picks but cannot be reached from the start point. */
  unreachable: { blockId: string; blockCode: string; picks: StopPick[] }[];
  /** True when the end point cannot be reached from the last stop. */
  endUnreachable: boolean;
  /** Pick lines whose block or floor no longer exists in the layout. */
  invalidLines: PickLine[];
}

export type PickStatus = 'pending' | 'collected' | 'skipped';

export interface PickSession {
  id: string;
  warehouseId: string;
  pickListId: string;
  name: string;
  /** Route snapshot taken when the session started. */
  route: RoutePlan;
  itemStatus: Record<string, PickStatus>;
  currentStop: number;
  status: 'active' | 'completed';
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  id: 'settings';
  activeWarehouseId: string | null;
  /** Real-world size of one grid cell, used to display walking distance. */
  cellSizeMeters: number;
  /** When true, workers may only walk on painted aisle cells. */
  aisleOnly: boolean;
}
