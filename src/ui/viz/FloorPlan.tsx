import type { DeviceState, SensorState, SimulatorState } from '../../compiler/index';

const ROOM_WIDTH = 270;
const GAP = 8;
const COLUMNS = 2;
const CELL = 86;
const DEVICES_PER_ROW = 3;
const ROW_HEIGHT = 66;
/** Space for the room name above the devices and the sensor chips below. */
const ROOM_CHROME = 72;

type Attr = DeviceState['attributes'];

function number(attributes: Attr, name: string, fallback = 0): number {
  const value = attributes[name];
  return typeof value === 'number' ? value : fallback;
}

function Light({ on, attributes, glowId }: { on: boolean; attributes: Attr; glowId: string }) {
  const brightness = number(attributes, 'BRIGHTNESS', 100);
  return (
    <>
      {on && <circle class="light-glow" r={34} fill={`url(#${glowId})`} style={{ opacity: Math.max(0.15, brightness / 100) }} />}
      <circle class={`bulb ${on ? 'is-on' : ''}`} r={10} />
      <rect class="bulb-base" x={-4} y={9} width={8} height={5} rx={1} />
    </>
  );
}

function AirConditioner({ on, attributes }: { on: boolean; attributes: Attr }) {
  return (
    <>
      <rect class={`ac-body ${on ? 'is-on' : ''}`} x={-26} y={-16} width={52} height={15} rx={3} />
      {on && [-14, 0, 14].map((x) => (
        <path key={x} class="airflow" d={`M ${x} 2 q 6 7 0 14 q -6 7 0 14`} />
      ))}
      <text class="ac-badge" y={-5} text-anchor="middle">{number(attributes, 'TEMPERATURE', 26)}°</text>
    </>
  );
}

function Heater({ on }: { on: boolean }) {
  return (
    <>
      {[-15, -5, 5, 15].map((x) => <rect key={x} class={`heater-fin ${on ? 'is-on' : ''}`} x={x - 3} y={-14} width={6} height={28} rx={2} />)}
    </>
  );
}

function Fan({ on, attributes }: { on: boolean; attributes: Attr }) {
  const speed = number(attributes, 'SPEED', 3);
  const spinning = on && speed > 0;
  return (
    <>
      <g class={spinning ? 'fan-blades is-spinning' : 'fan-blades'} style={spinning ? { animationDuration: `${1.6 / speed}s` } : undefined}>
        {[0, 120, 240].map((angle) => <ellipse key={angle} rx={6} ry={15} cy={-14} transform={`rotate(${angle})`} />)}
      </g>
      <circle class="fan-hub" r={4} />
    </>
  );
}

function Lock({ locked }: { locked: boolean }) {
  return (
    <>
      <path class={`shackle ${locked ? 'is-locked' : ''}`} d={locked ? 'M -9 -2 V -11 a 9 9 0 0 1 18 0 V -2' : 'M -9 -2 V -11 a 9 9 0 0 1 18 0 V -7'}
        transform={locked ? undefined : 'translate(5, -4)'} />
      <rect class={`lock-body ${locked ? 'is-locked' : ''}`} x={-13} y={-2} width={26} height={19} rx={3} />
    </>
  );
}

function Curtain({ attributes }: { attributes: Attr }) {
  const open = number(attributes, 'POSITION') / 100;
  const width = 24 - 19 * open;
  return (
    <>
      <rect class="window" x={-25} y={-15} width={50} height={32} rx={1} />
      <rect class="curtain-panel" x={-25} y={-15} width={width} height={32} />
      <rect class="curtain-panel" x={25 - width} y={-15} width={width} height={32} />
      <rect class="curtain-rod" x={-28} y={-18} width={56} height={3} rx={1} />
    </>
  );
}

function Plug({ on }: { on: boolean }) {
  return <rect class={`plug ${on ? 'is-on' : ''}`} x={-11} y={-11} width={22} height={22} rx={5} />;
}

function Glyph({ device, glowId }: { device: DeviceState; glowId: string }) {
  const { type, state, attributes } = device;
  const on = state === 'ON';
  switch (type) {
    case 'LIGHT':
      return <Light on={on} attributes={attributes} glowId={glowId} />;
    case 'AIR_CONDITIONER':
      return <AirConditioner on={on} attributes={attributes} />;
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

function sensorText(sensor: SensorState): string {
  return `${sensor.name} ${sensor.value}${sensor.unit ? ` ${sensor.unit}` : ''}`;
}

interface RoomProps {
  name: string;
  x: number;
  y: number;
  height: number;
  devices: readonly DeviceState[];
  sensors: readonly SensorState[];
  flashing: ReadonlySet<string>;
  glowId: string;
  testPrefix: string;
}

function Room({ name, x, y, height, devices, sensors, flashing, glowId, testPrefix }: RoomProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect class="room" width={ROOM_WIDTH} height={height} rx={6} />
      <text class="room-name" x={10} y={17}>{name.replace(/_/g, ' ')}</text>
      {devices.map((device, i) => (
        <g key={device.name} class={`device ${flashing.has(device.name) ? 'is-flashing' : ''}`}
          transform={`translate(${46 + (i % DEVICES_PER_ROW) * CELL}, ${56 + Math.floor(i / DEVICES_PER_ROW) * ROW_HEIGHT})`}
          data-testid={`${testPrefix}device-${device.name}`} data-state={device.state}>
          <Glyph device={device} glowId={glowId} />
          <text class="device-name" y={38} text-anchor="middle">{device.name}</text>
        </g>
      ))}
      <foreignObject x={6} y={height - 20} width={ROOM_WIDTH - 12} height={18}>
        <div class="sensor-chips">
          {sensors.map((s) => <span key={s.name} class="sensor-chip" data-testid={`${testPrefix}sensor-${s.name}`}>{sensorText(s)}</span>)}
        </div>
      </foreignObject>
    </g>
  );
}

interface FloorPlanProps {
  state: SimulatorState;
  rooms: readonly string[];
  flashing?: ReadonlySet<string>;
  /** Keeps ids and test ids apart when the plan appears twice on a page. */
  id: string;
}

const NOWHERE = 'HOME';
const NONE: ReadonlySet<string> = new Set();

export function FloorPlan({ state, rooms, flashing = NONE, id }: FloorPlanProps) {
  const glowId = `glow-${id}`;
  const unplaced = [...state.devices, ...state.sensors].some((item) => !item.room);
  const named = rooms.filter((r) => state.devices.some((d) => d.room === r) || state.sensors.some((s) => s.room === r));
  const shown = unplaced ? [...named, NOWHERE] : named;
  const rows = Math.max(1, Math.ceil(shown.length / COLUMNS));
  const inRoom = (room: string) => (item: { room?: string }) => (item.room ?? NOWHERE) === room;
  const busiest = Math.max(1, ...shown.map((room) => state.devices.filter(inRoom(room)).length));
  const roomHeight = ROOM_CHROME + Math.ceil(busiest / DEVICES_PER_ROW) * ROW_HEIGHT;
  const width = COLUMNS * ROOM_WIDTH + (COLUMNS - 1) * GAP;
  const height = rows * roomHeight + (rows - 1) * GAP;
  const prefix = id === 'output' ? '' : `${id}-`;

  return (
    <svg class="floor-plan" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Floor plan of the simulated home" data-testid={`${prefix}floor-plan`}>
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.95" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </radialGradient>
      </defs>
      {shown.map((room, i) => (
        <Room key={room} name={room} x={(i % COLUMNS) * (ROOM_WIDTH + GAP)} y={Math.floor(i / COLUMNS) * (roomHeight + GAP)} height={roomHeight}
          devices={state.devices.filter(inRoom(room))} sensors={state.sensors.filter(inRoom(room))}
          flashing={flashing} glowId={glowId} testPrefix={prefix} />
      ))}
    </svg>
  );
}
