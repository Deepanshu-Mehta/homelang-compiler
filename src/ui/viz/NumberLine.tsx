import { formatMinutes, type TruthLine } from '../../compiler/index';
import { useWidth } from '../useWidth';

const HEIGHT = 56;
const MARGIN = 28;
const AXIS_Y = 20;

function domainOf(line: TruthLine): [number, number] {
  if (line.isTime) return [0, 1440];
  const finite = line.intervals.flatMap((i) => [i.lo, i.hi]).filter(Number.isFinite);
  if (finite.length === 0) return [0, 100];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const pad = Math.max((hi - lo) * 0.5, 10);
  return [lo - pad, hi + pad];
}

/** The values for which a condition is true, shaded on the axis. */
export function NumberLine({ line }: { line: TruthLine }) {
  const [ref, width] = useWidth<HTMLElement>(320);
  const [min, max] = domainOf(line);
  const x = (value: number): number => {
    const clamped = Math.min(max, Math.max(min, value));
    return MARGIN + ((clamped - min) / (max - min)) * (width - 2 * MARGIN);
  };
  const label = (value: number): string => (line.isTime ? formatMinutes(value % 1440) : String(value));

  const ticks = line.isTime
    ? [0, 360, 720, 1080]
    : [...new Set(line.intervals.flatMap((i) => [i.lo, i.hi]).filter(Number.isFinite))];

  return (
    <figure class="number-line" ref={ref}>
      <figcaption><code>{line.ruleId}</code> {line.variable}{line.unit ? ` (${line.unit})` : ''}</figcaption>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
        aria-label={`True set of ${line.variable} in ${line.ruleId}`}>
        <line class="nl-axis" x1={MARGIN} y1={AXIS_Y} x2={width - MARGIN} y2={AXIS_Y} />
        {line.intervals.map((interval, i) => (
          <g key={i}>
            <rect class="nl-band" x={x(interval.lo)} y={AXIS_Y - 7}
              width={Math.max(2, x(interval.hi) - x(interval.lo))} height={14} />
            {Number.isFinite(interval.lo) && !(line.isTime && interval.lo === 0) &&
              <circle class={interval.loOpen ? 'nl-open' : 'nl-closed'} cx={x(interval.lo)} cy={AXIS_Y} r={5} />}
            {Number.isFinite(interval.hi) && !(line.isTime && interval.hi === 1440) &&
              <circle class={interval.hiOpen ? 'nl-open' : 'nl-closed'} cx={x(interval.hi)} cy={AXIS_Y} r={5} />}
          </g>
        ))}
        {ticks.map((tick) => <text key={tick} class="nl-tick" x={x(tick)} y={HEIGHT - 6} text-anchor="middle">{label(tick)}</text>)}
      </svg>
    </figure>
  );
}
