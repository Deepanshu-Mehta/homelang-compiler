import type { DeviceState, SensorState, SimulatorState } from '../../compiler/index';
import { useWidth } from '../useWidth';

type Attr = DeviceState['attributes'];

const NO_ROOM = 'HOME';
const NONE: ReadonlySet<string> = new Set();
const LARGE_FROM_PX = 620;

function number(attributes: Attr, name: string, fallback = 0): number {
  const value = attributes[name];
  return typeof value === 'number' ? value : fallback;
}

/** Every state is written out, so that the drawing never relies on colour. */
export function stateWords({ type, state, attributes }: DeviceState): string {
  switch (type) {
    case 'LIGHT':
      return state === 'ON' ? `ON ${number(attributes, 'BRIGHTNESS', 100)}%` : 'OFF';
    case 'AIR_CONDITIONER':
    case 'HEATER':
      return `${state} ${number(attributes, 'TEMPERATURE')} °C`;
    case 'FAN':
      return state === 'ON' ? `ON speed ${number(attributes, 'SPEED', 3)}` : 'OFF';
    case 'CURTAIN':
      return state === 'OPEN' ? `OPEN ${number(attributes, 'POSITION')}%` : 'CLOSED';
    default:
      return state;
  }
}

export function roomTitle(name: string): string {
  if (name === NO_ROOM) return 'Other';
  const words = name.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Light({ on, attributes, glowId }: { on: boolean; attributes: Attr; glowId: string }) {
  const brightness = number(attributes, 'BRIGHTNESS', 100) / 100;
  return (
    <>
      <circle class={`light-glow ${on ? 'is-on' : ''}`} r={36} fill={`url(#${glowId})`}
        style={{ transform: `scale(${on ? 0.55 + brightness * 0.45 : 0.3})`, opacity: on ? 0.35 + brightness * 0.65 : 0 }} />
      <circle class={`light-fixture ${on ? 'is-on' : ''}`} r={12} />
      <path class="light-cross" d="M -8.5 -8.5 L 8.5 8.5 M 8.5 -8.5 L -8.5 8.5" />
    </>
  );
}

function AirConditioner({ on }: { on: boolean }) {
  return (
    <>
      <rect class={`ac-unit ${on ? 'is-on' : ''}`} x={-24} y={-20} width={48} height={14} rx={2} />
      <path class="ac-vent" d="M -18 -13 H 18" />
      <g class={`airflow-group ${on ? 'is-on' : ''}`}>
        {[-14, 0, 14].map((x) => <path key={x} class="airflow" d={`M ${x} -3 q 5 6 0 11 q -5 6 0 11`} />)}
      </g>
    </>
  );
}

function Heater({ on }: { on: boolean }) {
  return (
    <>
      <rect class={`heater-body ${on ? 'is-on' : ''}`} x={-24} y={-14} width={48} height={28} rx={2} />
      {[-14, -5, 5, 14].map((x) => <path key={x} class="heater-fin" d={`M ${x} -9 V 9`} />)}
    </>
  );
}

function Fan({ on, attributes }: { on: boolean; attributes: Attr }) {
  const speed = number(attributes, 'SPEED', 3);
  return (
    <>
      <g class={`fan-blades ${on && speed > 0 ? 'is-on' : ''}`} style={{ animationDuration: `${1.8 / Math.max(1, speed)}s` }}>
        {[0, 120, 240].map((angle) => <path key={angle} d="M 0 -3 C -8 -8 -7 -19 0 -21 C 7 -19 8 -8 0 -3 Z" transform={`rotate(${angle})`} />)}
      </g>
      <circle class="fan-hub" r={4} />
    </>
  );
}

function Lock({ locked }: { locked: boolean }) {
  return (
    <g class={`lock ${locked ? 'is-locked' : ''}`}>
      <path class="lock-shackle" d="M -8 -2 V -9 a 8 8 0 0 1 16 0 V -2" />
      <rect class="lock-body" x={-13} y={-2} width={26} height={19} rx={2} />
      <circle class="lock-keyhole" cy={7} r={2.5} />
    </g>
  );
}

function Curtain({ attributes }: { attributes: Attr }) {
  const covered = 1 - number(attributes, 'POSITION') / 100;
  const scale = 0.18 + covered * 0.82;
  return (
    <>
      <rect class="curtain-glass" x={-26} y={-14} width={52} height={28} />
      <rect class="curtain-panel" x={-26} y={-14} width={26} height={28} style={{ transform: `scaleX(${scale})`, transformOrigin: '-26px 0' }} />
      <rect class="curtain-panel" x={0} y={-14} width={26} height={28} style={{ transform: `scaleX(${scale})`, transformOrigin: '26px 0' }} />
      <path class="curtain-rod" d="M -29 -16 H 29" />
    </>
  );
}

function Plug({ on }: { on: boolean }) {
  return (
    <>
      <circle class={`plug-body ${on ? 'is-on' : ''}`} r={14} />
      <path class="plug-pins" d="M -5 -6 V 0 M 5 -6 V 0 M -5 7 H 5" />
    </>
  );
}

function Symbol({ device, glowId }: { device: DeviceState; glowId: string }) {
  const { type, state, attributes } = device;
  const on = state === 'ON';
  switch (type) {
    case 'LIGHT':
      return <Light on={on} attributes={attributes} glowId={glowId} />;
    case 'AIR_CONDITIONER':
      return <AirConditioner on={on} />;
    case 'HEATER':
      return <Heater on={on} />;
    case 'FAN':
      return <Fan on={on} attributes={attributes} />;
    case 'DOOR_LOCK':
      return <Lock locked={state === 'LOCKED'} />;
    case 'CURTAIN':
      return <Curtain attributes={attributes} />;
    default:
      return <Plug on={on} />;
  }
}

interface RoomBox {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  devices: DeviceState[];
  sensors: SensorState[];
  perRow: number;
}

interface PlanMetrics {
  wall: number;
  outer: number;
  cellW: number;
  cellH: number;
  head: number;
  symbolScale: number;
  sensorRow: number;
  charW: number;
}

function sensorText(s: SensorState): string {
  return `${s.name} ${s.value}${s.unit ? ` ${s.unit}` : ''}`;
}

/** Sensors wrap into rows inside their room. Used only by the large plan. */
function sensorRows(sensors: readonly SensorState[], width: number, charW: number): SensorState[][] {
  const rows: SensorState[][] = [];
  let used = Infinity;
  for (const sensor of sensors) {
    const needed = sensorText(sensor).length * charW + 16;
    if (used + needed > width) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1]!.push(sensor);
    used += needed;
  }
  return rows;
}

function layoutRooms(names: readonly string[], state: SimulatorState, width: number, m: PlanMetrics, large: boolean): { rooms: RoomBox[]; height: number; rowCount: number } {
  const inRoom = (room: string) => (item: { room?: string }) => (item.room ?? NO_ROOM) === room;
  const columns = names.length <= 1 ? 1 : names.length <= 4 ? 2 : 3;
  const inner = width - 2 * m.outer;
  const rows: string[][] = [];
  for (let i = 0; i < names.length; i += columns) rows.push(names.slice(i, i + columns));

  const rooms: RoomBox[] = [];
  let y = m.outer;
  rows.forEach((row, rowIndex) => {
    // Rooms in a short last row share its width, so the building has no holes.
    const w = inner / row.length;
    const planned = row.map((name) => {
      const devices = state.devices.filter(inRoom(name));
      const sensors = state.sensors.filter(inRoom(name));
      const perRow = Math.max(1, Math.floor((w - 12) / m.cellW));
      const deviceRows = Math.ceil(devices.length / perRow);
      const chips = large ? sensorRows(sensors, w - 24, m.charW).length : 0;
      return { name, devices, sensors, perRow, height: m.head + Math.max(1, deviceRows) * m.cellH + chips * m.sensorRow + (large ? 14 : 4) };
    });
    const h = Math.max(...planned.map((p) => p.height));
    planned.forEach((p, i) => rooms.push({ ...p, x: m.outer + i * w, y, w, h, row: rowIndex }));
    y += h;
  });
  return { rooms, height: y + m.outer, rowCount: rows.length };
}

/** A gap in a wall, with the door leaf and its swing drawn in plan view. */
function DoorGap({ x, y, size, axis, side, wall }: { x: number; y: number; size: number; axis: 'h' | 'v'; side: 1 | -1; wall: number }) {
  if (axis === 'h') {
    return (
      <>
        <rect class="door-gap" x={x} y={y - wall} width={size} height={wall * 2} />
        <path class="door-leaf" d={`M ${x} ${y} V ${y + side * size}`} />
        <path class="door-swing" d={`M ${x} ${y + side * size} A ${size} ${size} 0 0 ${side > 0 ? 0 : 1} ${x + size} ${y}`} />
      </>
    );
  }
  return (
    <>
      <rect class="door-gap" x={x - wall} y={y} width={wall * 2} height={size} />
      <path class="door-leaf" d={`M ${x} ${y} H ${x + side * size}`} />
      <path class="door-swing" d={`M ${x + side * size} ${y} A ${size} ${size} 0 0 ${side > 0 ? 1 : 0} ${x} ${y + size}`} />
    </>
  );
}

interface FloorPlanProps {
  state: SimulatorState;
  rooms: readonly string[];
  flashing?: ReadonlySet<string>;
  /** Keeps ids and test ids apart when the plan appears twice on a page. */
  id: string;
}

/**
 * The home, drawn as an architect's plan: one building with solid walls, door
 * swings and windows, and each fixture seen from above. It draws to its measured
 * width, so its text stays at true size in both the side pane and the large view.
 */
export function FloorPlan({ state, rooms, flashing = NONE, id }: FloorPlanProps) {
  const [ref, width] = useWidth<HTMLDivElement>(400);
  const u = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
  const large = width >= LARGE_FROM_PX * u;
  const prefix = id === 'output' ? '' : `${id}-`;
  const glowId = `glow-${id}`;
  const charW = 8.8 * u;
  // A cell is never narrower than its longest label, so names cannot collide.
  const longest = Math.max(0, ...state.devices.map((d) => Math.max(d.name.length, stateWords(d).length)));
  const metrics: PlanMetrics = {
    wall: 4, outer: 6, cellW: Math.max((large ? 124 : 88) * u, longest * charW + 20 * u), cellH: (large ? 108 : 72) * u,
    head: (large ? 34 : 24) * u, symbolScale: large ? 1.3 * u : 0.8 * u, sensorRow: 28 * u, charW,
  };

  const unplaced = [...state.devices, ...state.sensors].some((item) => !item.room);
  const names = unplaced ? [...rooms, NO_ROOM] : [...rooms];
  const { rooms: boxes, height, rowCount } = layoutRooms(names, state, width, metrics, large);
  const doorRoom = state.devices.find((d) => d.type === 'DOOR_LOCK')?.room;
  const front = boxes.find((b) => b.name === doorRoom) ?? boxes[boxes.length - 1];
  const doorSize = (large ? 34 : 22) * u;
  const { outer, wall } = metrics;

  return (
    <div class="floor-plan-frame" ref={ref}>
      <svg class="floor-plan" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label="Floor plan of the simulated home" data-testid={`${prefix}floor-plan`}>
        <defs>
          <radialGradient id={glowId}>
            <stop class="glow-core" offset="0%" />
            <stop class="glow-edge" offset="100%" />
          </radialGradient>
        </defs>
        <rect class="plan-floor" x={outer / 2} y={outer / 2} width={width - outer} height={height - outer} />

        {/* Interior walls, drawn first so that doors can cut through them */}
        {boxes.map((b) => (
          <g key={b.name}>
            {b.x > outer + 1 && <path class="wall" stroke-width={wall} d={`M ${b.x} ${b.y} V ${b.y + b.h}`} />}
            {b.y > outer + 1 && <path class="wall" stroke-width={wall} d={`M ${b.x} ${b.y} H ${b.x + b.w}`} />}
          </g>
        ))}

        {/* Windows break the outer wall along the top of the building */}
        {boxes.filter((b) => b.row === 0).map((b) => (
          <rect key={b.name} class="plan-window" x={b.x + b.w * 0.5} y={outer / 2 - 2} width={b.w * 0.3} height={outer + 4} />
        ))}
        <rect class="wall-outer" x={outer / 2} y={outer / 2} width={width - outer} height={height - outer} stroke-width={outer} />
        {boxes.filter((b) => b.row === 0).map((b) => (
          <g key={b.name}>
            <rect class="plan-window-gap" x={b.x + b.w * 0.5} y={0} width={b.w * 0.3} height={outer} />
            <path class="plan-window-line" d={`M ${b.x + b.w * 0.5} ${outer / 2} h ${b.w * 0.3}`} />
          </g>
        ))}

        {/* Doors between rooms */}
        {boxes.map((b) => (
          <g key={b.name}>
            {b.x > outer + 1 && <DoorGap axis="v" side={1} wall={wall} size={doorSize} x={b.x} y={b.y + b.h - doorSize - 8} />}
            {b.y > outer + 1 && b.x <= outer + 1 && <DoorGap axis="h" side={1} wall={wall} size={doorSize} x={b.x + b.w - doorSize - 10} y={b.y} />}
          </g>
        ))}

        {/* The front door, in an outer wall */}
        {front && (
          front.row === rowCount - 1
            ? <DoorGap axis="h" side={-1} wall={outer} size={doorSize} x={front.x + front.w - doorSize - 10} y={height - outer / 2} />
            : <DoorGap axis="v" side={1} wall={outer} size={doorSize} x={outer / 2} y={front.y + front.h - doorSize - 8} />
        )}

        {boxes.map((b) => (
          <g key={b.name}>
            <text class="room-name" x={b.x + 10} y={b.y + 19 * u}>{roomTitle(b.name)}</text>
            {b.devices.map((device, i) => {
              const column = i % b.perRow;
              const row = Math.floor(i / b.perRow);
              const cellW = (b.w - 12) / b.perRow;
              const x = b.x + 6 + cellW * (column + 0.5);
              const top = b.y + metrics.head + row * metrics.cellH;
              const symbolY = top + metrics.cellH * 0.32;
              return (
                <g key={device.name} class={`device ${flashing.has(device.name) ? 'is-flashing' : ''}`}
                  data-testid={`${prefix}device-${device.name}`} data-state={device.state}>
                  <g transform={`translate(${x}, ${symbolY}) scale(${metrics.symbolScale})`}>
                    <Symbol device={device} glowId={glowId} />
                  </g>
                  <text class="device-name" x={x} y={top + metrics.cellH * 0.74} text-anchor="middle">{device.name}</text>
                  <text class="device-state" x={x} y={top + metrics.cellH * 0.94} text-anchor="middle"
                    data-testid={`${prefix}device-state-${device.name}`}>{stateWords(device)}</text>
                </g>
              );
            })}
            {large && sensorRows(b.sensors, b.w - 24, metrics.charW).map((row, rowIndex, all) => {
              let cursor = b.x + 12;
              const y = b.y + b.h - (all.length - rowIndex) * metrics.sensorRow - 8;
              return row.map((sensor) => {
                const text = sensorText(sensor);
                const w = text.length * metrics.charW + 12;
                const x = cursor;
                cursor += w + 6;
                return (
                  <g key={sensor.name} data-testid={`${prefix}sensor-${sensor.name}`}>
                    <rect class="sensor-chip" x={x} y={y} width={w} height={metrics.sensorRow - 6} rx={2} />
                    <text class="sensor-text" x={x + 5} y={y + (metrics.sensorRow - 6) * 0.72}>{text}</text>
                  </g>
                );
              });
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
