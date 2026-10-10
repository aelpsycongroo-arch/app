import { describe, expect, it } from 'vitest';
import { orderStops, pathCost, planRoute } from './routing';
import { createSampleData } from './sample';
import { newId } from './ids';
import type { PickLine } from './types';

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

function randomMatrix(n: number, seed: number) {
  // Points on a plane -> metric distances.
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts = Array.from({ length: n + 2 }, () => [Math.floor(rnd() * 50), Math.floor(rnd() * 50)]);
  return pts.map((a) => pts.map((b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])));
}

describe('stop ordering', () => {
  it('Held–Karp matches brute force for small instances', () => {
    for (let seed = 1; seed < 15; seed++) {
      const n = 6;
      const d = randomMatrix(n, seed);
      const order = orderStops(d, n);
      const best = Math.min(...permutations([1, 2, 3, 4, 5, 6]).map((p) => pathCost(d, p, n + 1)));
      expect(pathCost(d, order, n + 1)).toBe(best);
      expect([...order].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('heuristic handles larger instances and visits every stop once', () => {
    const n = 25;
    const d = randomMatrix(n, 7);
    const order = orderStops(d, n);
    expect(new Set(order).size).toBe(n);
    const identity = Array.from({ length: n }, (_, i) => i + 1);
    expect(pathCost(d, order, n + 1)).toBeLessThanOrEqual(pathCost(d, identity, n + 1));
  });
});

describe('planRoute on the sample warehouse', () => {
  const data = createSampleData();
  const blockByCode = (c: string) => data.blocks.find((b) => b.code === c)!;
  const line = (sku: string, code: string, level: number, quantity: number): PickLine => {
    const p = data.products.find((x) => x.sku === sku)!;
    const b = blockByCode(code);
    return { id: newId(), productId: p.id, sku, productName: p.name, quantity, blockId: b.id, floorId: b.floors.find((f) => f.level === level)!.id };
  };
  const entrance = data.warehouse.points.find((p) => p.kind === 'entrance')!;
  const exit = data.warehouse.points.find((p) => p.kind === 'exit')!;

  it('groups floors of the same block into one stop', () => {
    const lines = [line('SN001', 'A', 1, 5), line('SN002', 'A', 2, 3), line('SN003', 'C', 3, 10)];
    const plan = planRoute({ warehouse: data.warehouse, blocks: data.blocks, lines, start: entrance, end: exit, aisleOnly: false });
    expect(plan.stops.map((s) => s.blockCode).sort()).toEqual(['A', 'C']);
    const a = plan.stops.find((s) => s.blockCode === 'A')!;
    expect(a.picks.map((p) => [p.floorLevel, p.sku, p.quantity])).toEqual([[1, 'SN001', 5], [2, 'SN002', 3]]);
    expect(plan.unreachable).toEqual([]);
    expect(plan.endUnreachable).toBe(false);
    const legs = plan.stops.reduce((s, x) => s + x.distance, 0) + plan.finalLeg.distance;
    expect(plan.totalDistance).toBe(legs);
    // Path continuity: every step is one orthogonal move.
    const full = [...plan.stops.flatMap((s) => s.path), ...plan.finalLeg.path];
    for (let i = 1; i < full.length; i++) {
      const dist = Math.abs(full[i].x - full[i - 1].x) + Math.abs(full[i].y - full[i - 1].y);
      expect(dist).toBeLessThanOrEqual(1);
    }
  });

  it('never walks through walls or blocks', () => {
    const lines = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c) => {
      const p = data.inventory.find((r) => r.blockId === blockByCode(c).id)!;
      const prod = data.products.find((x) => x.id === p.productId)!;
      return { id: newId(), productId: prod.id, sku: prod.sku, productName: prod.name, quantity: 1, blockId: p.blockId, floorId: p.floorId };
    });
    const plan = planRoute({ warehouse: data.warehouse, blocks: data.blocks, lines, start: entrance, end: exit, aisleOnly: false });
    expect(plan.stops).toHaveLength(7);
    for (const p of [...plan.stops.flatMap((s) => s.path), ...plan.finalLeg.path]) {
      expect(data.warehouse.cells[`${p.x},${p.y}`]).not.toBe('wall');
      expect(data.blocks.some((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h)).toBe(false);
    }
  });

  it('also works in aisle-only mode', () => {
    const lines = [line('SN001', 'A', 1, 5), line('RC001', 'G', 1, 2), line('BS001', 'D', 1, 2)];
    const plan = planRoute({ warehouse: data.warehouse, blocks: data.blocks, lines, start: entrance, end: exit, aisleOnly: true });
    expect(plan.stops).toHaveLength(3);
    for (const p of plan.stops.flatMap((s) => s.path)) {
      const isPoint = data.warehouse.points.some((pt) => pt.x === p.x && pt.y === p.y);
      expect(isPoint || data.warehouse.cells[`${p.x},${p.y}`] === 'aisle').toBe(true);
    }
  });

  it('reports unreachable blocks and lines with deleted locations', () => {
    const w = structuredClone(data.warehouse);
    const g = blockByCode('G');
    // Wall off block G completely.
    for (let y = g.y - 1; y <= g.y + g.h; y++) for (let x = g.x - 1; x <= g.x + g.w; x++) {
      if (x < g.x || x >= g.x + g.w || y < g.y || y >= g.y + g.h) w.cells[`${x},${y}`] = 'wall';
    }
    const bad: PickLine = { ...line('SN001', 'A', 1, 1), floorId: 'missing' };
    const plan = planRoute({ warehouse: w, blocks: data.blocks, lines: [line('RC001', 'G', 1, 2), line('SN001', 'A', 1, 5), bad], start: entrance, end: exit, aisleOnly: false });
    expect(plan.unreachable.map((u) => u.blockCode)).toEqual(['G']);
    expect(plan.stops.map((s) => s.blockCode)).toEqual(['A']);
    expect(plan.invalidLines).toHaveLength(1);
  });
});
