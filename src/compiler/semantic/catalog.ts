import type { Dimension } from '../lexer/units';

/**
 * The device and sensor catalogue: the semantic phase's ground truth.
 * Value ranges follow the Matter clusters cited in the language reference,
 * narrowed where the course brief sets a tighter range (AC 16–30 °C).
 */

export type ActionName =
  | 'TURN_ON' | 'TURN_OFF' | 'TOGGLE' | 'SET' | 'LOCK' | 'UNLOCK' | 'OPEN' | 'CLOSE';

export type EventName =
  | 'TURNS_ON' | 'TURNS_OFF' | 'LOCKS' | 'UNLOCKS' | 'OPENS' | 'CLOSES'
  | 'DETECTED' | 'CLEARS' | 'RISES_ABOVE' | 'FALLS_BELOW' | 'CHANGES';

export interface NumericAttribute {
  kind: 'number';
  dim: Dimension;
  min: number;
  max: number;
  integer?: boolean;
  initial: number;
}

export interface EnumAttribute {
  kind: 'enum';
  values: readonly string[];
  initial: string;
}

export type Attribute = NumericAttribute | EnumAttribute;

export interface DeviceType {
  kind: 'device';
  name: string;
  actions: readonly ActionName[];
  attributes: Readonly<Record<string, Attribute>>;
  states: readonly string[];
  initialState: string;
  events: readonly EventName[];
  /** Setting this attribute above 0 switches the device on; setting 0 switches it off. */
  levelAttribute?: string;
}

export interface SensorType {
  kind: 'sensor';
  name: string;
  /** Present for numeric sensors. */
  dim?: Dimension;
  /** Readings outside this range raise W403. */
  plausible?: readonly [number, number];
  /** Present for enum sensors. */
  states?: readonly string[];
  initial: number | string;
  events: readonly EventName[];
}

export type CatalogType = DeviceType | SensorType;

const POWER_ACTIONS: readonly ActionName[] = ['TURN_ON', 'TURN_OFF', 'TOGGLE', 'SET'];
const POWER_EVENTS: readonly EventName[] = ['TURNS_ON', 'TURNS_OFF'];
const ON_OFF = ['ON', 'OFF'] as const;

export const DEVICE_TYPES: readonly DeviceType[] = [
  {
    kind: 'device', name: 'LIGHT', actions: POWER_ACTIONS, states: ON_OFF, initialState: 'OFF',
    events: POWER_EVENTS, levelAttribute: 'BRIGHTNESS',
    attributes: {
      BRIGHTNESS: { kind: 'number', dim: 'percent', min: 0, max: 100, initial: 100 },
      COLOR_TEMP: { kind: 'number', dim: 'colorTemp', min: 2000, max: 6500, initial: 4000 },
    },
  },
  {
    kind: 'device', name: 'AIR_CONDITIONER', actions: POWER_ACTIONS, states: ON_OFF,
    initialState: 'OFF', events: POWER_EVENTS,
    attributes: {
      TEMPERATURE: { kind: 'number', dim: 'temperature', min: 16, max: 30, initial: 26 },
      MODE: { kind: 'enum', values: ['COOL', 'DRY', 'FAN', 'AUTO'], initial: 'COOL' },
    },
  },
  {
    kind: 'device', name: 'HEATER', actions: POWER_ACTIONS, states: ON_OFF, initialState: 'OFF',
    events: POWER_EVENTS,
    attributes: {
      TEMPERATURE: { kind: 'number', dim: 'temperature', min: 7, max: 30, initial: 20 },
    },
  },
  {
    kind: 'device', name: 'FAN', actions: POWER_ACTIONS, states: ON_OFF, initialState: 'OFF',
    events: POWER_EVENTS, levelAttribute: 'SPEED',
    attributes: {
      SPEED: { kind: 'number', dim: 'count', min: 0, max: 5, integer: true, initial: 3 },
    },
  },
  {
    kind: 'device', name: 'DOOR_LOCK', actions: ['LOCK', 'UNLOCK'], attributes: {},
    states: ['LOCKED', 'UNLOCKED'], initialState: 'UNLOCKED', events: ['LOCKS', 'UNLOCKS'],
  },
  {
    kind: 'device', name: 'CURTAIN', actions: ['OPEN', 'CLOSE', 'SET'], states: ['OPEN', 'CLOSED'],
    initialState: 'CLOSED', events: ['OPENS', 'CLOSES'], levelAttribute: 'POSITION',
    attributes: {
      POSITION: { kind: 'number', dim: 'percent', min: 0, max: 100, initial: 0 },
    },
  },
  {
    kind: 'device', name: 'PLUG', actions: ['TURN_ON', 'TURN_OFF', 'TOGGLE'], attributes: {},
    states: ON_OFF, initialState: 'OFF', events: POWER_EVENTS,
  },
];

const THRESHOLD_EVENTS: readonly EventName[] = ['RISES_ABOVE', 'FALLS_BELOW'];

export const SENSOR_TYPES: readonly SensorType[] = [
  { kind: 'sensor', name: 'TEMP_SENSOR', dim: 'temperature', plausible: [-40, 60], initial: 28,
    events: [...THRESHOLD_EVENTS, 'CHANGES'] },
  { kind: 'sensor', name: 'HUMIDITY_SENSOR', dim: 'percent', plausible: [0, 100], initial: 50,
    events: [...THRESHOLD_EVENTS, 'CHANGES'] },
  { kind: 'sensor', name: 'LIGHT_SENSOR', dim: 'illuminance', plausible: [0, 100000], initial: 300,
    events: THRESHOLD_EVENTS },
  { kind: 'sensor', name: 'MOTION_SENSOR', states: ['DETECTED', 'CLEAR'], initial: 'CLEAR',
    events: ['DETECTED', 'CLEARS'] },
  { kind: 'sensor', name: 'CONTACT_SENSOR', states: ['OPEN', 'CLOSED'], initial: 'CLOSED',
    events: ['OPENS', 'CLOSES'] },
  { kind: 'sensor', name: 'PRESENCE_SENSOR', states: ['HOME', 'AWAY'], initial: 'HOME',
    events: ['CHANGES'] },
];

export const CATALOG: ReadonlyMap<string, CatalogType> = new Map<string, CatalogType>(
  [...DEVICE_TYPES, ...SENSOR_TYPES].map((t) => [t.name, t]),
);

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export const WEEKDAYS: readonly string[] = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
export const WEEKENDS: readonly string[] = ['SAT', 'SUN'];

/** The standard home loaded when a program declares nothing. */
export const PRELUDE = {
  rooms: ['LIVING_ROOM', 'BEDROOM', 'KITCHEN', 'ENTRANCE'],
  devices: [
    { name: 'AC', type: 'AIR_CONDITIONER', room: 'LIVING_ROOM' },
    { name: 'LIGHT', type: 'LIGHT', room: 'LIVING_ROOM' },
    { name: 'FAN', type: 'FAN', room: 'BEDROOM' },
    { name: 'DOOR', type: 'DOOR_LOCK', room: 'ENTRANCE' },
    { name: 'CURTAIN', type: 'CURTAIN', room: 'BEDROOM' },
  ],
  sensors: [
    { name: 'TEMPERATURE', type: 'TEMP_SENSOR', room: 'LIVING_ROOM' },
    { name: 'HUMIDITY', type: 'HUMIDITY_SENSOR', room: 'LIVING_ROOM' },
    { name: 'MOTION', type: 'MOTION_SENSOR', room: 'LIVING_ROOM' },
    { name: 'CONTACT', type: 'CONTACT_SENSOR', room: 'ENTRANCE' },
    { name: 'PRESENCE', type: 'PRESENCE_SENSOR', room: 'ENTRANCE' },
  ],
} as const;
