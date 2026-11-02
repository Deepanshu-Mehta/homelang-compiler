import type { Span } from '../diagnostics';
import type { Dimension, UnitName } from '../lexer/units';
import { CATALOG, PRELUDE, type CatalogType } from './catalog';

export type SymbolKind = 'ROOM' | 'DEVICE' | 'SENSOR' | 'BUILTIN';

export interface SymbolEntry {
  /** Canonical upper-case name, the key in the table. */
  name: string;
  displayName: string;
  kind: SymbolKind;
  typeName?: string;
  catalog?: CatalogType;
  room?: string;
  /** Unit that bare numbers take when compared with this sensor. */
  unit?: UnitName;
  dim?: Dimension;
  /** True for prelude rows and TIME/DAY, which the UI greys out. */
  builtin: boolean;
  declSpan?: Span;
  useCount: number;
  /** Rule ids that read or write this name; the dependency graph uses them. */
  readBy: string[];
  writtenBy: string[];
}

/**
 * The global scope: a hash map keyed by canonical upper-case name, so `ac` and
 * `AC` are one entry. The catalogue of types is a second, read-only scope.
 */
export class SymbolTable {
  private readonly entries = new Map<string, SymbolEntry>();

  get(name: string): SymbolEntry | undefined {
    return this.entries.get(name);
  }

  add(entry: SymbolEntry): void {
    this.entries.set(entry.name, entry);
  }

  all(): SymbolEntry[] {
    return [...this.entries.values()];
  }

  ofKind(kind: SymbolKind): SymbolEntry[] {
    return this.all().filter((s) => s.kind === kind);
  }
}

function blank(name: string, kind: SymbolKind, builtin: boolean): SymbolEntry {
  return { name, displayName: name, kind, builtin, useCount: 0, readBy: [], writtenBy: [] };
}

export function makeRoom(name: string, displayName: string, builtin: boolean, declSpan?: Span): SymbolEntry {
  return { ...blank(name, 'ROOM', builtin), displayName, ...(declSpan && { declSpan }) };
}

export function makeTyped(
  name: string,
  displayName: string,
  catalog: CatalogType,
  room: string | undefined,
  builtin: boolean,
  declSpan?: Span,
): SymbolEntry {
  const kind: SymbolKind = catalog.kind === 'device' ? 'DEVICE' : 'SENSOR';
  const dim = catalog.kind === 'sensor' ? catalog.dim : undefined;
  return {
    ...blank(name, kind, builtin),
    displayName,
    typeName: catalog.name,
    catalog,
    ...(room && { room }),
    ...(dim && { dim }),
    ...(dim === 'temperature' && { unit: 'C' as const }),
    ...(dim === 'percent' && { unit: '%' as const }),
    ...(dim === 'illuminance' && { unit: 'LUX' as const }),
    ...(declSpan && { declSpan }),
  };
}

/** TIME and DAY exist in every program. */
export function addBuiltins(table: SymbolTable): void {
  table.add({ ...blank('TIME', 'BUILTIN', true), typeName: 'TIME' });
  table.add({ ...blank('DAY', 'BUILTIN', true), typeName: 'DAY' });
}

export function addPrelude(table: SymbolTable): void {
  for (const room of PRELUDE.rooms) table.add(makeRoom(room, room, true));
  for (const { name, type, room } of [...PRELUDE.devices, ...PRELUDE.sensors]) {
    table.add(makeTyped(name, name, CATALOG.get(type)!, room, true));
  }
}
