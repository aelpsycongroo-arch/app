# Warehouse Blueprint

A small local-first web app for mapping warehouse storage blocks, assigning products to individual **floors** (shelf levels) of each block, importing a picking list from Excel/CSV, and generating an optimised walking route that workers follow in a large-button picking mode.

Built with React 19, TypeScript, Vite, Tailwind CSS 4 and IndexedDB (via `idb`). No backend: all data stays in the browser.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

On first launch choose **Load sample warehouse** to explore a 24×16 layout (blocks A–G, aisles, a wall, two entrances, one exit, 15 products), or create a blank layout.

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests (Vitest): pathfinding, route ordering, import matching, spreadsheet parsing, IndexedDB persistence |
| `npm run test:e2e` | End-to-end workflow tests (Playwright). Set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled Chromium instead of `npx playwright install chromium`. |

## Android app (APK)

The app is wrapped for Android with [Capacitor](https://capacitorjs.com/) (`android/` folder, config in `capacitor.config.ts`).

**Install on a phone:** every push to this branch runs the *Android APK* GitHub Actions workflow, which builds the APK and attaches it to the **`apk-latest` release** on the repository's Releases page. Open that page on the phone, download `WarehouseBlueprint.apk`, and open it. Android will ask you to allow *Install unknown apps* for your browser or file manager the first time.

- It is a **debug-signed** build intended for sideloading inside your team, not for the Play Store. The workflow caches its signing key, so newer APKs install as updates and keep the data on the phone. If the cache ever expires (GitHub deletes caches unused for 7 days), the next APK has a different signature: export a backup in Settings, uninstall, install the new APK and restore the backup.
- All data stays on the phone (the app's own storage). *Export backup* and *Download sample CSV* open Android's share sheet (save to Drive/Files, email, …).

**Build locally** (needs Android Studio / the Android SDK and Java 21):

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug   # → android/app/build/outputs/apk/debug/app-debug.apk
```

After changing web code, always run `npm run build && npx cap sync android` before building the APK. The app icon is generated from `assets/` with `npx @capacitor/assets generate --android`.

## Workflow

1. **Warehouse Map** — a top-down grid editor.
   - *Add block*: drag a rectangle (or click for a 2×2 block). Blocks get IDs A, B, C… which you can rename (e.g. `A01`).
   - *Select / Move*: click a block to open its side panel; drag blocks or entrance/exit markers to move them. Overlaps, walls and out-of-bounds moves are rejected.
   - *Add aisle*, *Wall / obstacle*, *Erase*: paint cells. Walls and blocks are never walked through.
   - *Set entrance* / *Set exit*: any number of each; pick which to use per route.
   - Resize the grid, zoom, and keep several layouts (switch in the header).
   - Block states: empty (dashed), has products (blue), selected (indigo outline), on route (amber), current destination (green, pulsing), completed (light green).
2. **Block panel** — floors table with location codes (`A-F1`, `A-F2`…). Add/remove/rename floors, assign existing or new products to a floor with a quantity, edit quantities inline, remove products, search within the block.
3. **Products** — catalogue (SKU, barcode, name, category) with total stock and every location. A product can have stock on several floors/blocks; each is a separate inventory record.
4. **Import Picking List** — upload `.xlsx`, `.xls` or `.csv` (or use the built-in sample). Preview → map columns (auto-suggested from headers) → match. Each row shows its status:
   - matched by SKU (or barcode; or exact name only when the file has no SKU),
   - **unknown SKU** → pick the product manually (name matches are only *suggested*),
   - **no registered location** → register one inline or exclude the row,
   - **stored in several locations** → choose one, or press *Auto-choose* (prefers blocks already on the route, splits if one location lacks stock),
   - invalid quantity → edit it; stock shortfalls are warnings.
   The list can only be created once every row is resolved or excluded. Locations are never guessed.
5. **Picking Route** — choose list, entrance and exit. Shows the path on the blueprint with numbered stops, total walking distance, block count, and per-stop floor-by-floor instructions. Walking legs and floor picks are shown separately.
6. **Worker Mode** — one stop at a time: `STOP 1 — BLOCK A`, then large rows like *Floor 1 — Sweet Snack 001 — Collect 5* with **Collected** / **Skip** buttons. *Complete block*, *Next block*, *Previous block*, a progress bar, the live map, and a finish screen listing anything skipped with *Go back to Block X*. Sessions are saved continuously; unfinished ones can be resumed after a reload from the Worker Mode screen.
7. **Settings** — metres per grid cell, “walk on aisles only”, JSON backup export/restore, add sample data, clear all data.

## Data model

```
Warehouse { id, name, width, height, cells{ "x,y": aisle|wall }, points[ entrance|exit ] }
Block     { id, warehouseId, code, x, y, w, h, floors[ { id, level, name } ] }
Product   { id, sku, barcode, name, category }
InventoryRecord { id, productId, warehouseId, blockId, floorId, quantity }   // one per product per floor
PickList  { id, warehouseId, name, lines[ { productId, sku, quantity, blockId, floorId } ] }
PickSession { id, pickListId, route (snapshot), itemStatus{ lineId: pending|collected|skipped }, currentStop, status }
```

Block and floor are separate fields everywhere; the display code `A-F2` is derived (`block.code` + `-F` + `floor.level`), so renaming a block updates all its location codes.

## Routing

- **Physical route on the 2-D blueprint only.** Every block with at least one pick becomes exactly **one stop**; floors are vertical positions at that stop and add no walking distance.
- The worker stands on a walkable cell orthogonally adjacent to the block (an *access cell*). Blocks and walls are obstacles; with *walk on aisles only*, only aisle cells (and entrances/exits) are walkable.
- **Stop order**: a distance matrix (entrance, stops, exit) is built from one BFS distance field per stop (unit-cost grid, identical to A* distances). The order is solved **exactly with Held–Karp** for up to 11 stops, otherwise **nearest-neighbour + 2-opt**, with the entrance and exit as fixed endpoints.
- **Legs**: each leg is then computed with **A\*** (Manhattan heuristic, 4-directional movement) from where the worker stands to the nearest access cell of the next block. The reported total is the sum of these actual legs.
- Unreachable blocks, unreachable exits and lines whose block/floor was deleted are reported, not silently dropped.

Code: `src/domain/grid.ts` (walk grid, A*, BFS), `src/domain/routing.ts` (grouping, ordering, plan), `src/domain/matching.ts` (import matching), `src/domain/spreadsheet.ts` (file parsing).

## Project layout

```
src/
  domain/      pure logic + tests (types, grid/A*, routing, matching, spreadsheet, sample data)
  db/          IndexedDB schema and batched writes
  store/       Zustand stores (app data with write-behind persistence, UI, import draft)
  components/  Blueprint SVG, block panel, UI primitives
  pages/       Map, Products, Import, Route, Worker, Settings
e2e/           Playwright end-to-end tests
```

## Known limitations

- **SheetJS (`xlsx`) advisory**: the npm-published `xlsx@0.18.5` has known advisories (prototype pollution, ReDoS) with no fix on npm; SheetJS publishes fixed builds only on its own CDN. Exposure here is limited (files are chosen by the user, parsed locally, capped at 10 MB, and the library is lazy-loaded only for Excel files), but you may want to switch to the official build: `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Data is per browser/device (IndexedDB). Use Settings → Export backup to move it.
- Movement is 4-directional on the grid; diagonal shortcuts across open floor are not modelled.
- A stop's access cell is chosen as the nearest one on arrival; for very long blocks the order optimiser treats any side of the block as equivalent.
