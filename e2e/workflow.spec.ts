import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';

/** Center of grid cell (x, y) on the blueprint, in page coordinates. */
async function cell(page: Page, x: number, y: number, gridWidth: number) {
  const box = (await page.getByTestId('blueprint').boundingBox())!;
  const size = box.width / gridWidth;
  return { x: box.x + (x + 0.5) * size, y: box.y + (y + 0.5) * size };
}

async function drag(page: Page, from: [number, number], to: [number, number], w: number) {
  const a = await cell(page, ...from, w);
  const b = await cell(page, ...to, w);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}

async function clickCell(page: Page, x: number, y: number, w: number) {
  const p = await cell(page, x, y, w);
  await page.mouse.click(p.x, p.y);
}

test('full workflow: layout → floors → products → import → route → worker mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  const W = 16;

  // 1. Blank warehouse
  await page.goto('/');
  await page.getByLabel('Layout name').fill('Test DC');
  await page.getByLabel('Width (cells)').fill(String(W));
  await page.getByLabel('Height (cells)').fill('10');
  await page.getByRole('button', { name: 'Create blank warehouse' }).click();
  await expect(page.getByText('16×10 grid')).toBeVisible();

  // 2. Draw block A (3×2) by dragging, drop block B (2×2) with a click
  await page.getByRole('button', { name: 'Add block' }).click();
  await drag(page, [2, 2], [4, 3], W);
  await expect(page.getByTestId('block-A')).toBeVisible();
  await clickCell(page, 10, 2, W);
  await expect(page.getByTestId('block-B')).toBeVisible();
  await expect(page.getByTestId('block-B')).toHaveAttribute('data-state', 'empty');

  // 3. Wall between them, then an aisle; overlapping block rejected
  await page.getByRole('button', { name: 'Wall / obstacle' }).click();
  await drag(page, [7, 0], [7, 6], W);
  await page.getByRole('button', { name: 'Add aisle' }).click();
  await drag(page, [0, 8], [15, 8], W);
  await page.getByRole('button', { name: 'Add block' }).click();
  await clickCell(page, 7, 3, W);
  await expect(page.getByRole('alert').filter({ hasText: /wall/i })).toBeVisible();

  // 4. Move block B one cell right with Select tool
  await page.getByRole('button', { name: 'Select / Move' }).click();
  await drag(page, [10, 2], [11, 2], W);
  await expect(page.getByTestId('block-panel')).toBeVisible();
  await expect(page.getByLabel('Block column')).toHaveValue('12');

  // 5. Block A: add a floor, rename block, assign products to separate floors
  await clickCell(page, 3, 2, W);
  const panel = page.getByTestId('block-panel');
  await expect(panel.getByLabel('Block ID')).toHaveValue('A');
  await panel.getByRole('button', { name: '+ Add floor' }).click();
  await expect(panel.getByTestId('floor-row-A-F4')).toBeVisible();

  const f1 = panel.getByTestId('floor-row-A-F1');
  await f1.getByRole('button', { name: 'Assign product' }).click();
  await panel.getByText('New product').click();
  await panel.getByLabel('New SKU').fill('SN001');
  await panel.getByLabel('New product name').fill('Sweet Snack 001');
  await panel.getByLabel('Quantity to assign').fill('50');
  await panel.getByRole('button', { name: 'Assign to A-F1' }).click();
  await expect(f1.getByText('Sweet Snack 001')).toBeVisible();

  const f2 = panel.getByTestId('floor-row-A-F2');
  await f2.getByRole('button', { name: 'Assign product' }).click();
  await panel.getByText('New product').click();
  await panel.getByLabel('New SKU').fill('SN002');
  await panel.getByLabel('New product name').fill('Spicy Snack 002');
  await panel.getByLabel('Quantity to assign').fill('30');
  await panel.getByRole('button', { name: 'Assign to A-F2' }).click();
  await expect(f2.getByText('Spicy Snack 002')).toBeVisible();
  await expect(f1.getByText('Spicy Snack 002')).toHaveCount(0);
  await expect(page.getByTestId('block-A')).toHaveAttribute('data-state', 'stocked');

  // Edit quantity inline, search within block
  await f2.getByLabel('Quantity of SN002 at A-F2').fill('35');
  await f2.getByLabel('Quantity of SN002 at A-F2').press('Enter');
  await panel.getByLabel('Search products in this block').fill('spicy');
  await expect(panel.getByTestId('floor-row-A-F1')).toHaveCount(0);
  await expect(panel.getByTestId('floor-row-A-F2')).toBeVisible();

  // 6. Products page: add SN003 and give it a location on B-F3; SN001 also on B-F1
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await expect(page.getByTestId('product-row-SN002')).toContainText('A-F2 × 35');
  await page.getByRole('button', { name: '+ Add product' }).click();
  await page.getByLabel('SKU', { exact: true }).fill('SN003');
  await page.getByLabel('Product name').fill('Chocolate Bar');
  await page.getByLabel('Category', { exact: true }).fill('Chocolate');
  await page.getByRole('button', { name: 'Save product' }).click();
  await page.getByLabel('Block', { exact: true }).selectOption({ label: 'Block B' });
  await page.getByLabel('Floor', { exact: true }).selectOption({ label: 'Floor 3 (B-F3)' });
  await page.getByLabel('Location quantity').fill('40');
  await page.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByTestId('product-row-SN003')).toContainText('B-F3 × 40');

  await page.getByTestId('product-row-SN001').getByRole('button', { name: 'Locations' }).click();
  await page.getByLabel('Block', { exact: true }).selectOption({ label: 'Block B' });
  await page.getByLabel('Location quantity').fill('10');
  await page.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByTestId('product-row-SN001')).toContainText('A-F1 × 50');
  await expect(page.getByTestId('product-row-SN001')).toContainText('B-F1 × 10');

  // 7. Import a CSV picking list
  await page.getByRole('button', { name: 'Import Picking List' }).click();
  const csv = 'Item Code,Description,Qty\nSN001,Sweet Snack 001,5\nSN002,Spicy Snack 002,3\nSN003,Chocolate Bar,10\nXX999,Mystery,2\n';
  await page.getByTestId('file-input').setInputFiles({ name: 'order-42.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('preview-table')).toContainText('Mystery');
  await expect(page.getByLabel('SKU / barcode column')).toHaveValue('0');
  await expect(page.getByLabel('Requested quantity column *')).toHaveValue('2');

  await expect(page.getByTestId('match-row-2')).toHaveAttribute('data-status', 'attention'); // SN001: two locations
  await expect(page.getByTestId('match-row-3')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('match-row-5')).toHaveAttribute('data-status', 'attention'); // unknown SKU
  const create = page.getByRole('button', { name: 'Create picking list & plan route' });
  await expect(create).toBeDisabled();

  await page.getByLabel('Location for row 2').selectOption({ label: 'A-F1 (50 in stock)' });
  await expect(page.getByTestId('match-row-2')).toHaveAttribute('data-status', 'ready');
  await page.getByTestId('match-row-5').getByRole('button', { name: 'Exclude' }).click();
  await expect(create).toBeEnabled();
  await create.click();

  // 8. Route: block A (2 floors) + block B, wall avoided
  await expect(page.getByTestId('block-count')).toHaveText('2');
  const stop1 = page.getByTestId('stop-1');
  const stop2 = page.getByTestId('stop-2');
  await expect(page.getByTestId('stop-list')).toContainText('BLOCK A');
  await expect(page.getByTestId('stop-list')).toContainText('BLOCK B');
  const aStop = (await stop1.textContent())!.includes('BLOCK A') ? stop1 : stop2;
  await expect(aStop).toContainText('Floor 1');
  await expect(aStop).toContainText('Floor 2');
  await expect(aStop).toContainText('Sweet Snack 001');
  await expect(aStop).toContainText('× 5');
  const dist = Number((await page.getByTestId('total-distance').textContent())!.replace(' m', ''));
  expect(dist).toBeGreaterThan(10);
  await page.screenshot({ path: 'test-results/route.png', fullPage: true });

  // 9. Worker mode
  await page.getByTestId('start-picking').click();
  await expect(page.getByTestId('current-stop')).toContainText('STOP 1');
  await expect(page.getByTestId('progress-text')).toContainText('0/3 items');
  const firstStopText = (await page.getByTestId('current-stop').textContent())!;
  const firstSku = firstStopText.includes('BLOCK A') ? 'SN001' : 'SN003';
  await page.getByRole('button', { name: `Collected ${firstSku}` }).click();
  await expect(page.getByTestId('progress-text')).toContainText('1/3 items');
  if (firstSku === 'SN001') await page.getByRole('button', { name: 'Skip SN002' }).click();
  await page.screenshot({ path: 'test-results/worker.png', fullPage: true });

  // Reload mid-session -> resume from the list
  await page.reload();
  await page.getByRole('button', { name: 'Worker Mode' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('progress-text')).toContainText('1/3 items');
  await page.getByTestId('next-block').click();
  await expect(page.getByTestId('current-stop')).toContainText('STOP 2');
  await page.getByTestId('complete-block').click();
  await expect(page.getByTestId('finish-card')).toBeVisible();
  if (firstSku === 'SN001') {
    await expect(page.getByTestId('finish-card')).toContainText('1 item(s) not collected yet');
    await page.getByRole('button', { name: 'Go back to Block A' }).click();
    await page.getByRole('button', { name: 'Collected SN002' }).click();
    await page.getByTestId('next-block').click();
    await page.getByTestId('next-block').click();
  } else {
    // First stop was B; A had SN001+SN002 completed at once. Go back and finish stop 1.
    await page.getByRole('button', { name: 'Go back to Block B' }).click();
    await page.getByTestId('complete-block').click();
  }
  await expect(page.getByTestId('finish-card')).toContainText('All items collected');
  await expect(page.getByTestId('progress-text')).toContainText('3/3 items');
  await page.getByTestId('finish-session').click();
  await expect(page.getByText('Completed sessions')).toBeVisible();

  // 10. Everything persisted across a reload
  await page.reload();
  await page.getByRole('button', { name: 'Warehouse Map' }).click();
  await expect(page.getByTestId('block-A')).toBeVisible();
  await expect(page.getByTestId('block-B')).toBeVisible();
  expect(errors).toEqual([]);
});

test('imports an Excel picking list against the sample warehouse', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample warehouse' }).click();
  await page.getByRole('button', { name: 'Import Picking List' }).click();

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['SKU', 'Product Name', 'Quantity'],
      ['SN001', 'Sweet Snack 001', 5],
      ['SN002', 'Spicy Snack 002', 3],
      ['SN003', 'Chocolate Bar', 10],
      ['DR002', 'Orange Juice 1L', 12],
      ['RC001', 'Jasmine Rice 5kg', 1],
    ]),
    'Order',
  );
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  await page.getByTestId('file-input').setInputFiles({
    name: 'order.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await expect(page.getByTestId('match-table')).toContainText('Orange Juice 1L');
  await page.getByRole('button', { name: /Auto-choose locations/ }).click();
  await page.getByRole('button', { name: 'Create picking list & plan route' }).click();

  // A (F1, F2), C (F3), G (F1), plus DR002 at B-F1 or E-F2
  await expect(page.getByTestId('block-count')).toHaveText('4');
  await expect(page.getByTestId('block-A')).toHaveAttribute('data-state', 'route');

  // Switching the entrance re-plans the route.
  const before = await page.getByTestId('total-distance').textContent();
  await page.getByLabel('Entrance').selectOption({ label: 'Side door' });
  await expect(page.getByTestId('total-distance')).not.toHaveText(before!);
  await page.screenshot({ path: 'test-results/route-sample.png', fullPage: true });
});
