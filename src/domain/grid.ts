import { cellKey } from './ids';
import type { Block, GridPoint, Warehouse } from './types';

export interface WalkGrid {
  width: number;
  height: number;
  /** 1 = walkable, 0 = blocked. Indexed by y * width + x. */
  walkable: Uint8Array;
}

export interface WalkOptions {
  /** Only painted aisle cells (plus entrance/exit points) are walkable. */
  aisleOnly: boolean;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function inBounds(w: number, h: number, x: number, y: number) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function blockContains(b: Pick<Block, 'x' | 'y' | 'w' | 'h'>, x: number, y: number) {
  return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
}

export function rectsOverlap(
  a: Pick<Block, 'x' | 'y' | 'w' | 'h'>,
  b: Pick<Block, 'x' | 'y' | 'w' | 'h'>,
) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Checks whether a block rectangle can be placed: inside the grid, not
 * overlapping other blocks, walls, or entrance/exit points.
 * Returns an error message, or null when valid.
 */
export function validateBlockRect(
  warehouse: Warehouse,
  blocks: Block[],
  rect: Pick<Block, 'x' | 'y' | 'w' | 'h'>,
  ignoreBlockId?: string,
): string | null {
  if (rect.w < 1 || rect.h < 1) return 'Block must be at least 1×1.';
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > warehouse.width || rect.y + rect.h > warehouse.height) {
    return 'Block must be inside the warehouse grid.';
  }
  for (const other of blocks) {
    if (other.id === ignoreBlockId || other.warehouseId !== warehouse.id) continue;
    if (rectsOverlap(rect, other)) return `Overlaps block ${other.code}.`;
  }
  for (const p of warehouse.points) {
    if (blockContains(rect, p.x, p.y)) return `Covers ${p.kind} "${p.label}".`;
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (warehouse.cells[cellKey(x, y)] === 'wall') return 'Covers a wall.';
    }
  }
  return null;
}

export function buildWalkGrid(warehouse: Warehouse, blocks: Block[], opts: WalkOptions): WalkGrid {
  const { width, height } = warehouse;
  const walkable = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = warehouse.cells[cellKey(x, y)];
      walkable[y * width + x] = kind === 'wall' ? 0 : opts.aisleOnly ? (kind === 'aisle' ? 1 : 0) : 1;
    }
  }
  for (const b of blocks) {
    if (b.warehouseId !== warehouse.id) continue;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (inBounds(width, height, x, y)) walkable[y * width + x] = 0;
      }
    }
  }
  // Entrance/exit points are always standable, even in aisle-only mode.
  for (const p of warehouse.points) {
    if (inBounds(width, height, p.x, p.y) && warehouse.cells[cellKey(p.x, p.y)] !== 'wall') {
      walkable[p.y * width + p.x] = 1;
    }
  }
  return { width, height, walkable };
}

export function isWalkable(grid: WalkGrid, x: number, y: number) {
  return inBounds(grid.width, grid.height, x, y) && grid.walkable[y * grid.width + x] === 1;
}

/** Walkable cells orthogonally adjacent to the block: where a worker can stand to pick. */
export function accessCells(grid: WalkGrid, block: Pick<Block, 'x' | 'y' | 'w' | 'h'>): GridPoint[] {
  const out: GridPoint[] = [];
  const push = (x: number, y: number) => {
    if (isWalkable(grid, x, y)) out.push({ x, y });
  };
  for (let x = block.x; x < block.x + block.w; x++) {
    push(x, block.y - 1);
    push(x, block.y + block.h);
  }
  for (let y = block.y; y < block.y + block.h; y++) {
    push(block.x - 1, y);
    push(block.x + block.w, y);
  }
  return out;
}

/** Minimal binary heap keyed by number. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.vals.length;
  }
  push(val: number, key: number) {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (v.length > 0) {
      k[0] = lastK;
      v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < v.length && k[l] < k[m]) m = l;
        if (r < v.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface PathResult {
  path: GridPoint[];
  cost: number;
}

/**
 * A* search on the 4-connected walk grid from any of `starts` to any of `goals`.
 * Uses the Manhattan distance to the nearest goal as an admissible heuristic.
 * Start/goal cells must be walkable. Returns null when no path exists.
 */
export function astar(grid: WalkGrid, starts: GridPoint[], goals: GridPoint[]): PathResult | null {
  const { width, height } = grid;
  const validStarts = starts.filter((p) => isWalkable(grid, p.x, p.y));
  const validGoals = goals.filter((p) => isWalkable(grid, p.x, p.y));
  if (!validStarts.length || !validGoals.length) return null;

  const goalSet = new Set(validGoals.map((g) => g.y * width + g.x));
  const h = (idx: number) => {
    const x = idx % width;
    const y = (idx - x) / width;
    let best = Infinity;
    for (const g of validGoals) {
      const d = Math.abs(g.x - x) + Math.abs(g.y - y);
      if (d < best) best = d;
    }
    return best;
  };

  const n = width * height;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();

  for (const s of validStarts) {
    const idx = s.y * width + s.x;
    gScore[idx] = 0;
    open.push(idx, h(idx));
  }

  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (goalSet.has(cur)) {
      const path: GridPoint[] = [];
      for (let i = cur; i !== -1; i = cameFrom[i]) {
        const x = i % width;
        path.push({ x, y: (i - x) / width });
      }
      path.reverse();
      return { path, cost: gScore[cur] };
    }
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!grid.walkable[ni] || closed[ni]) continue;
      const tentative = gScore[cur] + 1;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = cur;
        open.push(ni, tentative + h(ni));
      }
    }
  }
  return null;
}

/**
 * Breadth-first distance field from a set of sources (unit cost, 4-connected).
 * Used to build the stop-to-stop distance matrix in one pass per stop; the
 * distances are identical to those A* finds between the same cells.
 */
export function distanceField(grid: WalkGrid, sources: GridPoint[]): Int32Array {
  const { width, height } = grid;
  const dist = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (!isWalkable(grid, s.x, s.y)) continue;
    const idx = s.y * width + s.x;
    if (dist[idx] === 0) continue;
    dist[idx] = 0;
    queue[tail++] = idx;
  }
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!grid.walkable[ni] || dist[ni] !== -1) continue;
      dist[ni] = dist[cur] + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}
