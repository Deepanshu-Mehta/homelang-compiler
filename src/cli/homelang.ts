import { readFileSync } from 'node:fs';
import {
  compile, emit, EMIT_KINDS, EMIT_STAGE, stageResult, type Diagnostic, type EmitKind,
} from '../compiler/index';

const USAGE = `Usage: homelang compile <file.home> [--emit=${EMIT_KINDS.join('|')}] [--all-errors]`;

function formatDiagnostic(file: string, d: Diagnostic): string {
  return `${file}:${d.span.line}:${d.span.col}: ${d.severity} ${d.code}: ${d.message}\n  hint: ${d.hint}`;
}

function main(args: readonly string[]): number {
  const [command, file, ...flags] = args;
  if (command !== 'compile' || !file) {
    console.error(USAGE);
    return 2;
  }

  const emitFlag = flags.find((f) => f.startsWith('--emit='))?.slice('--emit='.length);
  if (emitFlag !== undefined && !EMIT_KINDS.includes(emitFlag as EmitKind)) {
    console.error(`Unknown --emit value '${emitFlag}'.\n${USAGE}`);
    return 2;
  }

  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    console.error(`Cannot read '${file}'.`);
    return 2;
  }

  const result = compile(source, { collectAllErrors: flags.includes('--all-errors') });
  for (const stage of result.stages) {
    for (const diagnostic of stage.diagnostics) console.error(formatDiagnostic(file, diagnostic));
  }

  if (emitFlag) process.stdout.write(emit(emitFlag as EmitKind, stageResult(result, EMIT_STAGE[emitFlag as EmitKind])));
  return result.stages.some((s) => s.status === 'error') ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
