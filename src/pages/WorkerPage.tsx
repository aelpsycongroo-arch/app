import { useMemo } from 'react';
import { Blueprint, BlueprintLegend, type BlueprintPath } from '../components/Blueprint';
import { Badge, Button, Card, EmptyState, cx } from '../components/ui';
import { formatDistance } from '../domain/format';
import type { PickSession, PickStatus, StopPick } from '../domain/types';
import { useStore } from '../store/useStore';
import { useUi } from '../store/ui';

export function WorkerPage() {
  const sessions = useStore((s) => s.sessions);
  const activeId = useUi((s) => s.activeSessionId);
  const session = sessions.find((s) => s.id === activeId && s.status === 'active');
  return session ? <PickingView session={session} /> : <SessionList />;
}

function SessionList() {
  const sessions = useStore((s) => s.sessions);
  const warehouses = useStore((s) => s.warehouses);
  const ui = useUi();
  const active = sessions.filter((s) => s.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt);
  const done = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.updatedAt - a.updatedAt);
  const progress = (s: PickSession) => {
    const all = Object.values(s.itemStatus);
    return `${all.filter((x) => x === 'collected').length}/${all.length} items`;
  };
  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? '?';

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Worker mode</h1>
      {active.length === 0 && done.length === 0 && (
        <EmptyState title="No picking sessions">
          <p className="mb-3">Open a picking list on the Picking Route page and press “Start picking”.</p>
          <Button variant="primary" size="lg" onClick={() => ui.navigate('route')}>
            Go to Picking Route
          </Button>
        </EmptyState>
      )}
      {active.length > 0 && (
        <Card title="Unfinished sessions" className="mb-4">
          <ul className="flex flex-col gap-2">
            {active.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold">{s.name}</div>
                  <div className="text-sm text-slate-500">
                    {whName(s.warehouseId)} · stop {Math.min(s.currentStop + 1, s.route.stops.length)} of {s.route.stops.length} · {progress(s)} · last
                    activity {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </div>
                <Button variant="success" size="lg" onClick={() => ui.setActiveSession(s.id)}>
                  Resume
                </Button>
                <Button variant="ghost" onClick={() => confirm('Discard this picking session?') && useStore.getState().deleteSession(s.id)}>
                  Discard
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {done.length > 0 && (
        <Card title="Completed sessions">
          <ul className="flex flex-col divide-y divide-slate-100">
            {done.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">
                  <strong>{s.name}</strong> · {progress(s)} · {new Date(s.updatedAt).toLocaleString()}
                </span>
                <Button size="sm" variant="ghost" onClick={() => useStore.getState().deleteSession(s.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function PickingView({ session }: { session: PickSession }) {
  const warehouse = useStore((s) => s.warehouses.find((w) => w.id === session.warehouseId));
  const allBlocks = useStore((s) => s.blocks);
  const cellSize = useStore((s) => s.settings.cellSizeMeters);
  const ui = useUi();
  const blocks = useMemo(() => allBlocks.filter((b) => b.warehouseId === session.warehouseId), [allBlocks, session.warehouseId]);
  const { route, itemStatus } = session;
  const stops = route.stops;
  const idx = Math.min(session.currentStop, stops.length);
  const atEnd = idx >= stops.length;
  const stop = stops[idx];
  const m = (c: number) => formatDistance(c, cellSize);

  const statuses = Object.values(itemStatus);
  const collected = statuses.filter((s) => s === 'collected').length;
  const total = statuses.length;
  const stopDone = (i: number) => stops[i].picks.every((p) => itemStatus[p.lineId] === 'collected');
  const completedBlocks = new Set(stops.filter((_, i) => stopDone(i)).map((s) => s.blockId));

  const update = (patch: Partial<PickSession>) => useStore.getState().updateSession(session.id, patch);
  const setStatus = (lineId: string, status: PickStatus) => update({ itemStatus: { ...itemStatus, [lineId]: status } });
  const goTo = (i: number) => update({ currentStop: Math.max(0, Math.min(stops.length, i)) });

  const completeBlock = () => {
    const next = { ...itemStatus };
    stop.picks.forEach((p) => {
      if (next[p.lineId] === 'pending') next[p.lineId] = 'collected';
    });
    update({ itemStatus: next, currentStop: idx + 1 });
  };

  const paths: BlueprintPath[] = [
    ...stops.map((s, i) => ({ points: s.path, variant: (i < idx ? 'done' : i === idx ? 'active' : 'route') as BlueprintPath['variant'] })),
    { points: route.finalLeg.path, variant: atEnd ? 'active' : 'route' },
  ];
  const outstanding = stops.flatMap((s, i) =>
    s.picks.filter((p) => itemStatus[p.lineId] !== 'collected').map((p) => ({ pick: p, stopIndex: i, blockCode: s.blockCode })),
  );

  return (
    <div className="flex flex-col gap-4 p-3 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => ui.setActiveSession(null)}>
            ← Pause
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-slate-500">{session.name}</div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={collected} aria-valuemax={total} aria-label="Picking progress">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${total ? (collected / total) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="text-right text-sm font-semibold tabular-nums" data-testid="progress-text">
            {collected}/{total} items
            <div className="text-xs font-normal text-slate-500">
              stop {Math.min(idx + 1, stops.length)} of {stops.length}
            </div>
          </div>
        </div>

        {!atEnd ? (
          <div className="rounded-xl border-2 border-emerald-500 bg-white shadow-md" data-testid="current-stop">
            <div className="flex flex-wrap items-baseline gap-3 rounded-t-lg bg-emerald-600 px-5 py-4 text-white">
              <h2 className="text-3xl font-extrabold tracking-tight">
                STOP {idx + 1} — BLOCK {stop.blockCode}
              </h2>
              <span className="text-emerald-100">Walk {m(stop.distance)} along the green path</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {stop.picks.map((p) => (
                <PickRow key={p.lineId} pick={p} status={itemStatus[p.lineId]} onSet={(s) => setStatus(p.lineId, s)} />
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-slate-200 p-4">
              <Button size="lg" variant="secondary" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
                ← Previous block
              </Button>
              <Button size="lg" variant="success" className="flex-1" onClick={completeBlock} data-testid="complete-block">
                ✓ Complete block {stop.blockCode}
              </Button>
              <Button size="lg" variant="primary" onClick={() => goTo(idx + 1)} data-testid="next-block">
                Next block →
              </Button>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-base text-slate-700 rounded-b-xl">
              {idx + 1 < stops.length ? (
                <>
                  Next: <strong>Block {stops[idx + 1].blockCode}</strong> · {m(stops[idx + 1].distance)} · {stops[idx + 1].picks.length} item(s)
                </>
              ) : (
                <>
                  Next: <strong>exit</strong> · {m(route.finalLeg.distance)}
                </>
              )}
            </div>
          </div>
        ) : (
          <FinishCard
            outstanding={outstanding}
            exitDistance={m(route.finalLeg.distance)}
            onBack={() => goTo(stops.length - 1)}
            onGoTo={goTo}
            onFinish={() => {
              update({ status: 'completed' });
              ui.setActiveSession(null);
              ui.toast('Picking session completed.', 'success');
            }}
          />
        )}
      </div>

      <aside className="w-full shrink-0 lg:w-[460px]">
        <div className="overflow-auto rounded-md bg-white p-2 shadow-sm ring-1 ring-slate-200">
          {warehouse ? (
            <Blueprint
              warehouse={warehouse}
              blocks={blocks}
              routeBlockIds={new Set(stops.map((s) => s.blockId))}
              completedBlockIds={completedBlocks}
              currentBlockId={stop?.blockId ?? null}
              stopNumbers={new Map(stops.map((s, i) => [s.blockId, i + 1]))}
              paths={paths}
              cellPx={Math.max(12, Math.min(28, Math.floor(440 / warehouse.width)))}
            />
          ) : (
            <p className="p-4 text-sm text-slate-500">The layout for this session was deleted.</p>
          )}
        </div>
        <div className="mt-2">
          <BlueprintLegend items={['current', 'route', 'done']} />
        </div>
        <ol className="mt-3 flex flex-col gap-1">
          {stops.map((s, i) => (
            <li key={s.blockId}>
              <button
                type="button"
                onClick={() => goTo(i)}
                className={cx(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                  i === idx ? 'bg-emerald-100 font-semibold' : 'hover:bg-slate-100',
                )}
              >
                <span className="w-6 text-slate-500">{i + 1}.</span> Block {s.blockCode}
                <span className="ml-auto">
                  {stopDone(i) ? (
                    <Badge tone="green">done</Badge>
                  ) : s.picks.some((p) => itemStatus[p.lineId] === 'skipped') ? (
                    <Badge tone="amber">skipped items</Badge>
                  ) : (
                    <Badge>{s.picks.filter((p) => itemStatus[p.lineId] === 'collected').length}/{s.picks.length}</Badge>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function PickRow({ pick, status, onSet }: { pick: StopPick; status: PickStatus; onSet: (s: PickStatus) => void }) {
  return (
    <li
      className={cx('flex flex-wrap items-center gap-4 px-5 py-4', status === 'collected' && 'bg-emerald-50', status === 'skipped' && 'bg-amber-50')}
      data-testid={`pick-${pick.sku}`}
      data-status={status}
    >
      <div className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-lg bg-indigo-600 text-white">
        <span className="text-xs uppercase">Floor</span>
        <span className="text-3xl font-extrabold leading-none">{pick.floorLevel}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className={cx('text-xl font-semibold', status === 'collected' && 'text-emerald-800 line-through decoration-2')}>{pick.productName}</div>
        <div className="text-sm text-slate-500">
          SKU {pick.sku}
          {pick.floorName && pick.floorName !== `Floor ${pick.floorLevel}` && ` · ${pick.floorName}`}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs uppercase text-slate-500">Collect</div>
        <div className="text-3xl font-extrabold tabular-nums">{pick.quantity}</div>
      </div>
      <div className="flex gap-2">
        {status === 'collected' ? (
          <Button size="lg" variant="secondary" onClick={() => onSet('pending')}>
            Undo
          </Button>
        ) : (
          <>
            <Button size="lg" variant="success" onClick={() => onSet('collected')} aria-label={`Collected ${pick.sku}`}>
              ✓ Collected
            </Button>
            {status === 'skipped' ? (
              <Button size="lg" variant="secondary" onClick={() => onSet('pending')}>
                Unskip
              </Button>
            ) : (
              <Button size="lg" variant="secondary" onClick={() => onSet('skipped')} aria-label={`Skip ${pick.sku}`}>
                Skip
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function FinishCard({
  outstanding,
  exitDistance,
  onBack,
  onGoTo,
  onFinish,
}: {
  outstanding: { pick: StopPick; stopIndex: number; blockCode: string }[];
  exitDistance: string;
  onBack: () => void;
  onGoTo: (i: number) => void;
  onFinish: () => void;
}) {
  return (
    <div className="rounded-xl border-2 border-slate-300 bg-white p-5 shadow-md" data-testid="finish-card">
      <h2 className="mb-1 text-3xl font-extrabold">{outstanding.length ? 'Almost done' : 'All items collected'}</h2>
      <p className="mb-4 text-lg text-slate-600">Walk {exitDistance} to the exit along the green path.</p>
      {outstanding.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 font-semibold text-amber-800">{outstanding.length} item(s) not collected yet</h3>
          <ul className="flex flex-col gap-2">
            {outstanding.map(({ pick, stopIndex, blockCode }) => (
              <li key={pick.lineId} className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-2">
                <span className="font-semibold">
                  Block {blockCode} · Floor {pick.floorLevel}
                </span>
                <span className="flex-1">
                  {pick.productName} × {pick.quantity}
                </span>
                <Button onClick={() => onGoTo(stopIndex)}>Go back to Block {blockCode}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={onBack}>
          ← Back to last block
        </Button>
        <Button size="xl" variant="success" className="flex-1" onClick={onFinish} data-testid="finish-session">
          {outstanding.length ? 'Finish with missing items' : 'Finish picking'}
        </Button>
      </div>
    </div>
  );
}
