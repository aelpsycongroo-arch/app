import { accessCells, astar, buildWalkGrid, distanceField, isWalkable, type WalkGrid } from './grid';
import { sortFloors } from './location';
import type { Block, GridPoint, PickLine, RoutePlan, RouteStop, StopPick, Warehouse } from './types';

/** Up to this many stops the visiting order is solved exactly (Held–Karp). */
export const EXACT_ORDER_LIMIT = 11;

/**
 * Groups pick lines by block. Every block becomes one physical stop; the
 * floors are vertical positions within that stop, so they add no walking.
 */
export function groupPicksByBlock(lines: PickLine[], blocks: Block[]) {
  const byBlock = new Map<string, { block: Block; picks: StopPick[] }>();
  const invalid: PickLine[] = [];
  for (const line of lines) {
    const block = blocks.find((b) => b.id === line.blockId);
    const floor = block?.floors.find((f) => f.id === line.floorId);
    if (!block || !floor) {
      invalid.push(line);
      continue;
    }
    let entry = byBlock.get(block.id);
    if (!entry) {
      entry = { block, picks: [] };
      byBlock.set(block.id, entry);
    }
    entry.picks.push({
      lineId: line.id,
      floorId: floor.id,
      floorLevel: floor.level,
      floorName: floor.name,
      productId: line.productId,
      sku: line.sku,
      productName: line.productName,
      quantity: line.quantity,
    });
  }
  const levelOrder = (b: Block) => new Map(sortFloors(b.floors).map((f, i) => [f.id, i]));
  for (const { block, picks } of byBlock.values()) {
    const order = levelOrder(block);
    picks.sort((a, b) => (order.get(a.floorId)! - order.get(b.floorId)!) || a.sku.localeCompare(b.sku));
  }
  return { groups: [...byBlock.values()], invalid };
}

/** Length of an open path 0 -> order... -> end over matrix d. */
export function pathCost(d: number[][], order: number[], end: number): number {
  let cost = 0;
  let prev = 0;
  for (const i of order) {
    cost += d[prev][i];
    prev = i;
  }
  return cost + d[prev][end];
}

/**
 * Chooses the visiting order of stops 1..n given a distance matrix where node
 * 0 is the start and node n+1 the end. Exact Held–Karp DP for small n,
 * nearest-neighbour + 2-opt otherwise.
 */
export function orderStops(d: number[][], n: number): number[] {
  if (n === 0) return [];
  const end = n + 1;
  if (n <= EXACT_ORDER_LIMIT) return heldKarp(d, n, end);
  return twoOpt(d, nearestNeighbour(d, n), end);
}

function heldKarp(d: number[][], n: number, end: number): number[] {
  const full = (1 << n) - 1;
  // dp[mask * n + j] = cheapest cost to start at 0, visit `mask`, finish at stop j+1
  const dp = new Float64Array((full + 1) * n).fill(Infinity);
  const parent = new Int8Array((full + 1) * n).fill(-1);
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = d[0][j + 1];
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * n + j];
      if (cur === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const cost = cur + d[j + 1][k + 1];
        if (cost < dp[next * n + k]) {
          dp[next * n + k] = cost;
          parent[next * n + k] = j;
        }
      }
    }
  }
  let bestJ = 0;
  let best = Infinity;
  for (let j = 0; j < n; j++) {
    const c = dp[full * n + j] + d[j + 1][end];
    if (c < best) {
      best = c;
      bestJ = j;
    }
  }
  const order: number[] = [];
  let mask = full;
  let j = bestJ;
  while (j !== -1) {
    order.push(j + 1);
    const pj = parent[mask * n + j];
    mask &= ~(1 << j);
    j = pj;
  }
  return order.reverse();
}

function nearestNeighbour(d: number[][], n: number): number[] {
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
  const order: number[] = [];
  let cur = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      if (d[cur][i] < bestD) {
        bestD = d[cur][i];
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
    cur = best;
  }
  return order;
}

function twoOpt(d: number[][], order: number[], end: number): number[] {
  const route = [0, ...order, end];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 2; i++) {
      for (let k = i + 1; k < route.length - 1; k++) {
        const delta =
          d[route[i - 1]][route[k]] + d[route[i]][route[k + 1]] - d[route[i - 1]][route[i]] - d[route[k]][route[k + 1]];
        if (delta < -1e-9) {
          route.splice(i, k - i + 1, ...route.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return route.slice(1, -1);
}

export interface PlanInput {
  warehouse: Warehouse;
  blocks: Block[];
  lines: PickLine[];
  start: GridPoint;
  end: GridPoint;
  aisleOnly: boolean;
}

export function planRoute(input: PlanInput): RoutePlan {
  const { warehouse, start, end } = input;
  const blocks = input.blocks.filter((b) => b.warehouseId === warehouse.id);
  const grid = buildWalkGrid(warehouse, blocks, { aisleOnly: input.aisleOnly });
  const { groups, invalid } = groupPicksByBlock(input.lines, blocks);

  const startField = isWalkable(grid, start.x, start.y) ? distanceField(grid, [start]) : null;
  const reachable: { block: Block; picks: StopPick[]; access: GridPoint[] }[] = [];
  const unreachable: RoutePlan['unreachable'] = [];
  for (const g of groups) {
    const access = accessCells(grid, g.block);
    const ok = startField && access.some((c) => startField[c.y * grid.width + c.x] >= 0);
    if (ok) reachable.push({ ...g, access });
    else unreachable.push({ blockId: g.block.id, blockCode: g.block.code, picks: g.picks });
  }

  const order = optimiseOrder(grid, start, end, reachable.map((r) => r.access));
  const stops: RouteStop[] = [];
  let cursor: GridPoint = start;
  let total = 0;
  for (const idx of order) {
    const r = reachable[idx];
    const leg = astar(grid, [cursor], r.access)!;
    const accessCell = leg.path[leg.path.length - 1];
    stops.push({
      blockId: r.block.id,
      blockCode: r.block.code,
      accessCell,
      path: leg.path,
      distance: leg.cost,
      picks: r.picks,
    });
    total += leg.cost;
    cursor = accessCell;
  }
  const last = startField ? astar(grid, [cursor], [end]) : null;
  const finalLeg = last ? { path: last.path, distance: last.cost } : { path: [], distance: 0 };
  total += finalLeg.distance;

  return {
    start,
    end,
    stops,
    finalLeg,
    totalDistance: total,
    unreachable,
    endUnreachable: !last,
    invalidLines: invalid,
  };
}

/** Returns indices into `accessSets` in the order they should be visited. */
function optimiseOrder(grid: WalkGrid, start: GridPoint, end: GridPoint, accessSets: GridPoint[][]): number[] {
  const n = accessSets.length;
  if (n === 0) return [];
  const BIG = 1e9;
  const fields = [distanceField(grid, [start]), ...accessSets.map((s) => distanceField(grid, s))];
  const targets: GridPoint[][] = [[start], ...accessSets, [end]];
  const minTo = (field: Int32Array, cells: GridPoint[]) => {
    let best = BIG;
    for (const c of cells) {
      const v = field[c.y * grid.width + c.x];
      if (v >= 0 && v < best) best = v;
    }
    return best;
  };
  const d: number[][] = [];
  for (let i = 0; i <= n; i++) {
    d.push(targets.map((t, j) => (i === j ? 0 : minTo(fields[i], t))));
  }
  d.push(targets.map((_, j) => (j <= n ? d[j][n + 1] : 0)));
  return orderStops(d, n).map((i) => i - 1);
}
