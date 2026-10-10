import { describe, expect, it } from 'vitest';
import { accessCells, astar, buildWalkGrid, distanceField, validateBlockRect } from './grid';
import { cellKey } from './ids';
import { createEmptyWarehouse } from './sample';
import type { Block } from './types';

const block = (warehouseId: string, code: string, x: number, y: number, w: number, h: number): Block => ({
  id: code,
  warehouseId,
  code,
  x,
  y,
  w,
  h,
  floors: [],
});

describe('A* pathfinding', () => {
  it('finds the shortest path around a wall', () => {
    const w = createEmptyWarehouse('t', 7, 5);
    for (let y = 0; y < 4; y++) w.cells[cellKey(3, y)] = 'wall';
    const grid = buildWalkGrid(w, [], { aisleOnly: false });
    const res = astar(grid, [{ x: 0, y: 0 }], [{ x: 6, y: 0 }])!;
    expect(res.cost).toBe(6 + 4 * 2);
    expect(res.path.some((p) => p.x === 3 && p.y < 4)).toBe(false);
    expect(res.path[0]).toEqual({ x: 0, y: 0 });
    expect(res.path.at(-1)).toEqual({ x: 6, y: 0 });
  });

  it('does not walk through blocks and agrees with BFS distances', () => {
    const w = createEmptyWarehouse('t', 10, 6);
    const blocks = [block(w.id, 'A', 2, 0, 2, 5), block(w.id, 'B', 6, 1, 2, 5)];
    const grid = buildWalkGrid(w, blocks, { aisleOnly: false });
    const field = distanceField(grid, [{ x: 0, y: 0 }]);
    for (const target of [{ x: 9, y: 0 }, { x: 5, y: 3 }, { x: 9, y: 5 }]) {
      const res = astar(grid, [{ x: 0, y: 0 }], [target])!;
      expect(res.cost).toBe(field[target.y * 10 + target.x]);
      for (const p of res.path) expect(blocks.some((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h)).toBe(false);
    }
  });

  it('returns null when the goal is enclosed', () => {
    const w = createEmptyWarehouse('t', 5, 5);
    for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) w.cells[cellKey(x, y)] = 'wall';
    const grid = buildWalkGrid(w, [], { aisleOnly: false });
    expect(astar(grid, [{ x: 0, y: 0 }], [{ x: 2, y: 2 }])).toBeNull();
  });

  it('aisle-only mode restricts walking to aisles (plus entrance/exit points)', () => {
    const w = createEmptyWarehouse('t', 5, 3);
    w.points = [{ id: 'e', kind: 'entrance', label: 'E', x: 0, y: 0 }];
    for (let x = 0; x < 5; x++) w.cells[cellKey(x, 2)] = 'aisle';
    w.cells[cellKey(0, 1)] = 'aisle';
    const grid = buildWalkGrid(w, [], { aisleOnly: true });
    const res = astar(grid, [{ x: 0, y: 0 }], [{ x: 4, y: 0 }]);
    expect(res).toBeNull();
    expect(astar(grid, [{ x: 0, y: 0 }], [{ x: 4, y: 2 }])!.cost).toBe(6);
  });

  it('access cells are the walkable neighbours of a block', () => {
    const w = createEmptyWarehouse('t', 6, 6);
    const b = block(w.id, 'A', 0, 0, 2, 2);
    w.cells[cellKey(2, 0)] = 'wall';
    const grid = buildWalkGrid(w, [b], { aisleOnly: false });
    expect(accessCells(grid, b)).toEqual(
      expect.arrayContaining([{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 1 }]),
    );
    expect(accessCells(grid, b)).toHaveLength(3);
  });
});

describe('block validation', () => {
  it('rejects overlaps, out-of-bounds, walls and points', () => {
    const w = createEmptyWarehouse('t', 10, 10);
    w.cells[cellKey(5, 5)] = 'wall';
    const blocks = [block(w.id, 'A', 0, 0, 3, 3)];
    expect(validateBlockRect(w, blocks, { x: 2, y: 2, w: 2, h: 2 })).toMatch(/Overlaps block A/);
    expect(validateBlockRect(w, blocks, { x: 9, y: 0, w: 2, h: 1 })).toMatch(/inside/);
    expect(validateBlockRect(w, blocks, { x: 4, y: 4, w: 2, h: 2 })).toMatch(/wall/);
    expect(validateBlockRect(w, blocks, { x: 0, y: 8, w: 2, h: 2 })).toMatch(/entrance/);
    expect(validateBlockRect(w, blocks, { x: 4, y: 0, w: 2, h: 2 })).toBeNull();
    expect(validateBlockRect(w, blocks, { x: 1, y: 1, w: 3, h: 3 }, 'A')).toBeNull();
  });
});
