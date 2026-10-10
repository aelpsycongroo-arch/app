import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { flush, useStore } from './useStore';

describe('store persistence (IndexedDB)', () => {
  beforeEach(async () => {
    await useStore.getState().clearAll();
  });

  it('persists warehouse, blocks, floors, products and stock and reloads them', async () => {
    const s = useStore.getState();
    const wid = s.createWarehouse('Main', 12, 8);
    const { block } = useStore.getState().addBlock(wid, { x: 2, y: 2, w: 3, h: 2 });
    expect(block?.code).toBe('A');
    expect(block?.floors.map((f) => f.level)).toEqual([1, 2, 3]);
    useStore.getState().addFloor(block!.id);
    const { product } = useStore.getState().saveProduct({ sku: 'SN001', barcode: '', name: 'Sweet Snack 001', category: 'Sweet Snacks' });
    const f2 = useStore.getState().blocks[0].floors[1];
    expect(useStore.getState().assignStock(product!.id, block!.id, f2.id, 30)).toBeNull();
    expect(useStore.getState().assignStock(product!.id, block!.id, f2.id, 5)).toBeNull();
    useStore.getState().paintCells(wid, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 'aisle');
    await flush();

    useStore.setState({ warehouses: [], blocks: [], products: [], inventory: [], loaded: false });
    await useStore.getState().init();
    const st = useStore.getState();
    expect(st.warehouses.map((w) => w.name)).toEqual(['Main']);
    expect(st.settings.activeWarehouseId).toBe(wid);
    expect(st.blocks[0].floors).toHaveLength(4);
    expect(st.inventory).toHaveLength(1);
    expect(st.inventory[0]).toMatchObject({ blockId: block!.id, floorId: f2.id, quantity: 35 });
    expect(st.warehouses[0].cells).toEqual({ '0,0': 'aisle', '1,0': 'aisle' });
  });

  it('validates block moves, codes and cascades deletes', async () => {
    const wid = useStore.getState().createWarehouse('W', 10, 10);
    const a = useStore.getState().addBlock(wid, { x: 0, y: 0, w: 2, h: 2 }).block!;
    const b = useStore.getState().addBlock(wid, { x: 4, y: 0, w: 2, h: 2 }).block!;
    expect(b.code).toBe('B');
    expect(useStore.getState().updateBlock(b.id, { x: 1 })).toMatch(/Overlaps/);
    expect(useStore.getState().updateBlock(b.id, { code: 'a' })).toMatch(/already used/);
    expect(useStore.getState().updateBlock(b.id, { code: 'a01' })).toBeNull();
    expect(useStore.getState().blocks.find((x) => x.id === b.id)!.code).toBe('A01');
    expect(useStore.getState().resizeWarehouse(wid, 5, 10)).toMatch(/outside/);

    const { product } = useStore.getState().saveProduct({ sku: 'X', barcode: '', name: 'X', category: '' });
    expect(useStore.getState().saveProduct({ sku: 'x', barcode: '', name: 'dup', category: '' }).error).toMatch(/already/);
    useStore.getState().assignStock(product!.id, a.id, a.floors[0].id, 3);
    useStore.getState().assignStock(product!.id, a.id, a.floors[1].id, 4);
    useStore.getState().removeFloor(a.id, a.floors[0].id);
    expect(useStore.getState().inventory).toHaveLength(1);
    useStore.getState().deleteBlock(a.id);
    expect(useStore.getState().inventory).toHaveLength(0);
    await flush();
  });

  it('loads the sample warehouse', async () => {
    useStore.getState().loadSample();
    await flush();
    await useStore.getState().init();
    const st = useStore.getState();
    expect(st.blocks.map((b) => b.code).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(st.products).toHaveLength(15);
    // Loading twice re-uses products with the same SKU.
    useStore.getState().loadSample();
    expect(useStore.getState().products).toHaveLength(15);
    expect(useStore.getState().warehouses).toHaveLength(2);
  });
});
