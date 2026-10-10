import { useMemo, useState } from 'react';
import { Blueprint, BlueprintLegend, type BlueprintPath } from '../components/Blueprint';
import { Badge, Button, Card, EmptyState, Field, Select, cx } from '../components/ui';
import { formatDistance } from '../domain/format';
import { planRoute } from '../domain/routing';
import type { AccessPoint, PickList, RoutePlan, StopPick, Warehouse } from '../domain/types';
import { useActiveWarehouse, useStore } from '../store/useStore';
import { useUi } from '../store/ui';

export function RoutePage() {
  const warehouse = useActiveWarehouse();
  const allLists = useStore((s) => s.pickLists);
  const selectedId = useUi((s) => s.selectedPickListId);
  const lists = useMemo(
    () => allLists.filter((l) => l.warehouseId === warehouse?.id).sort((a, b) => b.createdAt - a.createdAt),
    [allLists, warehouse?.id],
  );
  if (!warehouse) return <div className="p-6"><EmptyState title="No warehouse layout yet">Create a layout on the Warehouse Map first.</EmptyState></div>;
  const list = lists.find((l) => l.id === selectedId) ?? lists[0];
  if (!list)
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState title="No picking lists yet">
          <p className="mb-3">Import a spreadsheet to create a picking list for {warehouse.name}.</p>
          <Button variant="primary" onClick={() => useUi.getState().navigate('import')}>
            Import picking list
          </Button>
        </EmptyState>
      </div>
    );
  return <RouteView key={list.id} warehouse={warehouse} list={list} lists={lists} />;
}

export function usePointChoice(warehouse: Warehouse) {
  const entrances = warehouse.points.filter((p) => p.kind === 'entrance');
  const exits = warehouse.points.filter((p) => p.kind === 'exit');
  const [startId, setStartId] = useState(entrances[0]?.id ?? warehouse.points[0]?.id ?? '');
  const [endId, setEndId] = useState(exits[0]?.id ?? entrances[0]?.id ?? '');
  const start = warehouse.points.find((p) => p.id === startId) ?? entrances[0] ?? warehouse.points[0];
  const end = warehouse.points.find((p) => p.id === endId) ?? exits[0] ?? start;
  return { entrances, exits, start, end, setStartId, setEndId };
}

function RouteView({ warehouse, list, lists }: { warehouse: Warehouse; list: PickList; lists: PickList[] }) {
  const allBlocks = useStore((s) => s.blocks);
  const settings = useStore((s) => s.settings);
  const inventory = useStore((s) => s.inventory);
  const ui = useUi();
  const blocks = useMemo(() => allBlocks.filter((b) => b.warehouseId === warehouse.id), [allBlocks, warehouse.id]);
  const { entrances, exits, start, end, setStartId, setEndId } = usePointChoice(warehouse);
  const [focus, setFocus] = useState<number | null>(null);

  const plan = useMemo(
    () => (start && end ? planRoute({ warehouse, blocks, lines: list.lines, start, end, aisleOnly: settings.aisleOnly }) : null),
    [warehouse, blocks, list.lines, start, end, settings.aisleOnly],
  );

  if (!start || !end) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState title="This layout has no entrance">Add an entrance (and optionally an exit) on the Warehouse Map.</EmptyState>
      </div>
    );
  }

  const m = (cells: number) => formatDistance(cells, settings.cellSizeMeters);
  const units = list.lines.reduce((s, l) => s + l.quantity, 0);
  const floorsTouched = plan ? new Set(plan.stops.flatMap((s) => s.picks.map((p) => p.floorId))).size : 0;
  const stockShort = list.lines.filter((l) => {
    const inv = inventory.find((r) => r.productId === l.productId && r.blockId === l.blockId && r.floorId === l.floorId);
    return !inv || inv.quantity < l.quantity;
  });

  const paths: BlueprintPath[] = plan
    ? [
        ...plan.stops.map((s, i) => ({ points: s.path, variant: (focus === i ? 'active' : 'route') as BlueprintPath['variant'] })),
        { points: plan.finalLeg.path, variant: focus === plan.stops.length ? 'active' : 'route' },
      ]
    : [];

  const startSession = () => {
    if (!plan) return;
    const id = useStore.getState().startSession(list, plan);
    ui.setActiveSession(id);
    ui.navigate('worker');
  };

  return (
    <div className="flex flex-col gap-4 p-4 xl:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Picking list">
            <Select value={list.id} onChange={(e) => ui.setSelectedPickList(e.target.value)} aria-label="Picking list">
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {new Date(l.createdAt).toLocaleString()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start at (entrance)">
            <Select value={start.id} onChange={(e) => setStartId(e.target.value)} aria-label="Entrance">
              {(entrances.length ? entrances : warehouse.points).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Finish at (exit)">
            <Select value={end.id} onChange={(e) => setEndId(e.target.value)} aria-label="Exit">
              {[...exits, ...entrances].map((p: AccessPoint) => (
                <option key={p.id} value={p.id}>
                  {p.kind === 'entrance' ? `Back to ${p.label}` : p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="ghost"
            className="text-red-600"
            onClick={() => {
              if (confirm(`Delete picking list "${list.name}"?`)) {
                useStore.getState().deletePickList(list.id);
                ui.setSelectedPickList(null);
              }
            }}
          >
            Delete list
          </Button>
        </div>

        {plan && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="route-summary">
            <Stat label="Total walking distance" value={m(plan.totalDistance)} testId="total-distance" />
            <Stat label="Blocks to visit" value={String(plan.stops.length)} testId="block-count" />
            <Stat label="Floors to pick from" value={String(floorsTouched)} />
            <Stat label="Items / units" value={`${list.lines.length} / ${units}`} />
          </div>
        )}

        <Warnings plan={plan} stockShortCount={stockShort.length} />

        <div className="overflow-auto rounded-md bg-white p-2 shadow-sm ring-1 ring-slate-200">
          {plan && (
            <Blueprint
              warehouse={warehouse}
              blocks={blocks}
              routeBlockIds={new Set(plan.stops.map((s) => s.blockId))}
              currentBlockId={focus !== null ? plan.stops[focus]?.blockId : null}
              stopNumbers={new Map(plan.stops.map((s, i) => [s.blockId, i + 1]))}
              paths={paths}
              activePointIds={new Set([start.id, end.id])}
              onBlockClick={(b) => {
                const i = plan.stops.findIndex((s) => s.blockId === b.id);
                setFocus(i >= 0 ? i : null);
              }}
              cellPx={28}
            />
          )}
        </div>
        <div className="mt-2">
          <BlueprintLegend items={['route', 'current', 'stocked', 'empty', 'wall', 'points']} />
        </div>
      </div>

      <aside className="w-full shrink-0 xl:w-[460px]">
        {plan && (
          <Card
            title="Route & picking instructions"
            actions={
              <Button variant="success" onClick={startSession} disabled={plan.stops.length === 0} data-testid="start-picking">
                Start picking →
              </Button>
            }
          >
            <ol className="flex flex-col gap-2" data-testid="stop-list">
              <li className="flex items-center gap-2 text-sm text-slate-600">
                <span className="rounded bg-emerald-600 px-1.5 text-xs font-bold text-white">IN</span> Start at {start.label}
              </li>
              {plan.stops.map((s, i) => (
                <li key={s.blockId}>
                  <WalkLeg text={`Walk ${m(s.distance)} to Block ${s.blockCode}`} />
                  <button
                    type="button"
                    onClick={() => setFocus(focus === i ? null : i)}
                    className={cx(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      focus === i ? 'border-emerald-500 bg-emerald-50' : 'border-amber-300 bg-amber-50/50 hover:bg-amber-50',
                    )}
                    data-testid={`stop-${i + 1}`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white">{i + 1}</span>
                      <span className="font-bold">BLOCK {s.blockCode}</span>
                      <span className="ml-auto text-xs text-slate-500">
                        {s.picks.length} item(s) · {new Set(s.picks.map((p) => p.floorId)).size} floor(s)
                      </span>
                    </div>
                    <PickTable picks={s.picks} />
                  </button>
                </li>
              ))}
              <li>
                <WalkLeg text={`Walk ${m(plan.finalLeg.distance)} to ${end.label}`} />
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="rounded bg-red-600 px-1.5 text-xs font-bold text-white">OUT</span> Finish at {end.label}
                </div>
              </li>
            </ol>
          </Card>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold tabular-nums" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function WalkLeg({ text }: { text: string }) {
  return (
    <div className="my-1 ml-2 flex items-center gap-2 border-l-2 border-dashed border-slate-300 py-1 pl-4 text-xs font-medium uppercase tracking-wide text-slate-500">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M3 8h9M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {text}
    </div>
  );
}

export function PickTable({ picks }: { picks: StopPick[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {picks.map((p) => (
          <tr key={p.lineId} className="border-t border-amber-200/60 first:border-t-0">
            <td className="w-20 py-1 pr-2">
              <Badge tone="indigo">Floor {p.floorLevel}</Badge>
            </td>
            <td className="py-1">
              {p.productName} <span className="text-xs text-slate-500">({p.sku})</span>
            </td>
            <td className="py-1 text-right font-semibold tabular-nums">× {p.quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Warnings({ plan, stockShortCount }: { plan: RoutePlan | null; stockShortCount: number }) {
  if (!plan) return null;
  const items: string[] = [];
  for (const u of plan.unreachable) {
    items.push(`Block ${u.blockCode} cannot be reached from the chosen entrance (${u.picks.length} item(s) left out). Check walls/aisles around it.`);
  }
  if (plan.endUnreachable) items.push('The chosen exit cannot be reached from the last stop.');
  if (plan.invalidLines.length) {
    items.push(`${plan.invalidLines.length} line(s) point to a block or floor that no longer exists: ${plan.invalidLines.map((l) => l.sku).join(', ')}. Re-import the list.`);
  }
  if (stockShortCount) items.push(`${stockShortCount} line(s) request more than the recorded stock at their location.`);
  if (!items.length) return null;
  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
      <ul className="list-disc pl-5">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
