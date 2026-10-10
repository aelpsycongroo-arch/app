import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Block, GridPoint, Warehouse } from '../domain/types';

export interface BlueprintPath {
  points: GridPoint[];
  variant: 'route' | 'active' | 'done';
}

export interface BlueprintProps {
  warehouse: Warehouse;
  blocks: Block[];
  /** Blocks that hold at least one product. */
  stockedBlockIds?: Set<string>;
  selectedBlockId?: string | null;
  selectedPointId?: string | null;
  routeBlockIds?: Set<string>;
  currentBlockId?: string | null;
  completedBlockIds?: Set<string>;
  stopNumbers?: Map<string, number>;
  paths?: BlueprintPath[];
  /** Entrance/exit ids used by the active route, drawn emphasised. */
  activePointIds?: Set<string>;
  ghost?: { x: number; y: number; w: number; h: number; valid: boolean } | null;
  /** Pixel size of one grid cell. */
  cellPx?: number;
  onCellDown?: (cell: GridPoint, e: ReactPointerEvent<SVGSVGElement>) => void;
  onCellMove?: (cell: GridPoint, e: ReactPointerEvent<SVGSVGElement>) => void;
  onCellUp?: (cell: GridPoint, e: ReactPointerEvent<SVGSVGElement>) => void;
  onBlockClick?: (block: Block) => void;
  cursor?: string;
  children?: ReactNode;
}

const COLORS = {
  empty: { fill: '#ffffff', stroke: '#94a3b8', text: '#475569' },
  stocked: { fill: '#e0f2fe', stroke: '#0284c7', text: '#075985' },
  route: { fill: '#fef3c7', stroke: '#d97706', text: '#92400e' },
  done: { fill: '#dcfce7', stroke: '#16a34a', text: '#166534' },
  current: { fill: '#22c55e', stroke: '#15803d', text: '#ffffff' },
};

export function Blueprint(props: BlueprintProps) {
  const { warehouse: w, blocks, cellPx = 32 } = props;
  const svgRef = useRef<SVGSVGElement>(null);

  const toCell = (e: ReactPointerEvent<SVGSVGElement>): GridPoint => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * w.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * w.height);
    return { x: Math.max(0, Math.min(w.width - 1, x)), y: Math.max(0, Math.min(w.height - 1, y)) };
  };

  const cells = Object.entries(w.cells).map(([k, kind]) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, kind };
  });

  return (
    <svg
      ref={svgRef}
      data-testid="blueprint"
      viewBox={`0 0 ${w.width} ${w.height}`}
      width={w.width * cellPx}
      height={w.height * cellPx}
      className="block max-w-none touch-none select-none"
      style={{ cursor: props.cursor }}
      onPointerDown={(e) => {
        if (!props.onCellDown) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        props.onCellDown(toCell(e), e);
      }}
      onPointerMove={(e) => props.onCellMove?.(toCell(e), e)}
      onPointerUp={(e) => props.onCellUp?.(toCell(e), e)}
    >
      <defs>
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e2e8f0" strokeWidth="0.04" />
        </pattern>
        <pattern id="wall-hatch" width="0.35" height="0.35" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.35" height="0.35" fill="#475569" />
          <line x1="0" y1="0" x2="0" y2="0.35" stroke="#334155" strokeWidth="0.15" />
        </pattern>
      </defs>
      <rect width={w.width} height={w.height} fill="#f8fafc" />
      {cells.map((c) =>
        c.kind === 'aisle' ? (
          <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={1} height={1} fill="#fef9c3" />
        ) : (
          <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={1} height={1} fill="url(#wall-hatch)" />
        ),
      )}
      <rect width={w.width} height={w.height} fill="url(#grid)" />
      <rect width={w.width} height={w.height} fill="none" stroke="#64748b" strokeWidth="0.08" />

      {(props.paths ?? []).map((p, i) =>
        p.points.length > 1 ? (
          <polyline
            key={i}
            points={p.points.map((pt) => `${pt.x + 0.5},${pt.y + 0.5}`).join(' ')}
            fill="none"
            stroke={p.variant === 'active' ? '#16a34a' : p.variant === 'done' ? '#94a3b8' : '#f59e0b'}
            strokeWidth={p.variant === 'active' ? 0.22 : 0.15}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.variant === 'active' ? '0.5 0.5' : p.variant === 'done' ? '0.2 0.2' : undefined}
            className={p.variant === 'active' ? 'path-march' : undefined}
            opacity={p.variant === 'done' ? 0.7 : 0.95}
          />
        ) : null,
      )}

      {blocks.map((b) => {
        const isCurrent = props.currentBlockId === b.id;
        const state = isCurrent
          ? 'current'
          : props.completedBlockIds?.has(b.id)
            ? 'done'
            : props.routeBlockIds?.has(b.id)
              ? 'route'
              : props.stockedBlockIds?.has(b.id)
                ? 'stocked'
                : 'empty';
        const c = COLORS[state];
        const selected = props.selectedBlockId === b.id;
        const stop = props.stopNumbers?.get(b.id);
        const fontSize = Math.min(0.7, Math.max(0.35, Math.min(b.w, b.h) * 0.45));
        return (
          <g
            key={b.id}
            data-testid={`block-${b.code}`}
            data-state={state}
            onClick={props.onBlockClick ? () => props.onBlockClick!(b) : undefined}
            style={props.onBlockClick ? { cursor: 'pointer' } : undefined}
          >
            <rect
              x={b.x + 0.06}
              y={b.y + 0.06}
              width={b.w - 0.12}
              height={b.h - 0.12}
              rx={0.15}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={state === 'empty' ? 0.05 : 0.08}
              strokeDasharray={state === 'empty' ? '0.2 0.12' : undefined}
            />
            {isCurrent && (
              <rect x={b.x - 0.08} y={b.y - 0.08} width={b.w + 0.16} height={b.h + 0.16} rx={0.25} fill="none" stroke="#16a34a" strokeWidth={0.14} className="pulse-ring" />
            )}
            {selected && (
              <rect x={b.x - 0.04} y={b.y - 0.04} width={b.w + 0.08} height={b.h + 0.08} rx={0.2} fill="none" stroke="#4f46e5" strokeWidth={0.12} />
            )}
            <text
              x={b.x + b.w / 2}
              y={b.y + b.h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight={700}
              fill={c.text}
              pointerEvents="none"
            >
              {b.code}
            </text>
            {b.h >= 2 || b.w >= 3 ? (
              <text x={b.x + b.w / 2} y={b.y + b.h / 2 + fontSize * 0.85} textAnchor="middle" dominantBaseline="central" fontSize={0.28} fill={c.text} opacity={0.8} pointerEvents="none">
                {b.floors.length}F
              </text>
            ) : null}
            {stop !== undefined && (
              <g pointerEvents="none">
                <circle cx={b.x + 0.1} cy={b.y + 0.1} r={0.36} fill={isCurrent ? '#15803d' : '#d97706'} stroke="#fff" strokeWidth={0.06} />
                <text x={b.x + 0.1} y={b.y + 0.12} textAnchor="middle" dominantBaseline="central" fontSize={0.4} fontWeight={700} fill="#fff">
                  {stop}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {w.points.map((p) => {
        const entrance = p.kind === 'entrance';
        const active = props.activePointIds?.has(p.id);
        const selected = props.selectedPointId === p.id;
        return (
          <g key={p.id} data-testid={`point-${p.label}`} pointerEvents="none">
            <rect
              x={p.x + 0.08}
              y={p.y + 0.08}
              width={0.84}
              height={0.84}
              rx={0.2}
              fill={entrance ? '#059669' : '#dc2626'}
              opacity={props.activePointIds && !active ? 0.45 : 1}
              stroke={selected ? '#4f46e5' : '#fff'}
              strokeWidth={selected ? 0.12 : 0.05}
            />
            <text x={p.x + 0.5} y={p.y + 0.52} textAnchor="middle" dominantBaseline="central" fontSize={0.3} fontWeight={700} fill="#fff">
              {entrance ? 'IN' : 'OUT'}
            </text>
          </g>
        );
      })}

      {props.ghost && (
        <rect
          x={props.ghost.x}
          y={props.ghost.y}
          width={props.ghost.w}
          height={props.ghost.h}
          rx={0.15}
          fill={props.ghost.valid ? '#6366f1' : '#ef4444'}
          fillOpacity={0.25}
          stroke={props.ghost.valid ? '#4f46e5' : '#dc2626'}
          strokeWidth={0.08}
          strokeDasharray="0.25 0.15"
          pointerEvents="none"
        />
      )}
      {props.children}
    </svg>
  );
}

export function BlueprintLegend({ items }: { items: ('empty' | 'stocked' | 'selected' | 'route' | 'current' | 'done' | 'aisle' | 'wall' | 'points')[] }) {
  const swatch = (fill: string, stroke: string, dashed = false) => (
    <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: fill, border: `2px ${dashed ? 'dashed' : 'solid'} ${stroke}` }} />
  );
  const map = {
    empty: [swatch(COLORS.empty.fill, COLORS.empty.stroke, true), 'Empty block'],
    stocked: [swatch(COLORS.stocked.fill, COLORS.stocked.stroke), 'Has products'],
    selected: [swatch('#fff', '#4f46e5'), 'Selected'],
    route: [swatch(COLORS.route.fill, COLORS.route.stroke), 'On route'],
    current: [swatch(COLORS.current.fill, COLORS.current.stroke), 'Current destination'],
    done: [swatch(COLORS.done.fill, COLORS.done.stroke), 'Completed'],
    aisle: [swatch('#fef9c3', '#fde68a'), 'Aisle'],
    wall: [swatch('#475569', '#334155'), 'Wall / obstacle'],
    points: [
      <span key="p" className="flex gap-0.5">
        <span className="rounded-sm bg-emerald-600 px-1 text-[9px] font-bold text-white">IN</span>
        <span className="rounded-sm bg-red-600 px-1 text-[9px] font-bold text-white">OUT</span>
      </span>,
      'Entrance / exit',
    ],
  } as const;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          {map[k][0]}
          {map[k][1]}
        </span>
      ))}
    </div>
  );
}
