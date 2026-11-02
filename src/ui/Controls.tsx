import { formatMinutes, type ObjectFile, type SensorState } from '../compiler/index';
import type { Simulation } from './useSimulation';
import { roomTitle } from './viz/FloorPlan';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Sliders stop at sensible values rather than the sensor's full range. */
function sliderRange(sensor: SensorState): { min: number; max: number; step: number } {
  if (sensor.unit === '°C') return { min: -10, max: 50, step: 0.5 };
  if (sensor.unit === 'lux') return { min: 0, max: 2000, step: 10 };
  return { min: 0, max: 100, step: 1 };
}

function SensorControl({ sensor, sim, prefix }: { sensor: SensorState; sim: Simulation; prefix: string }) {
  const { name, value, states, unit } = sensor;
  if (states) {
    return (
      <div class="control">
        <span class="control-label"><span class="control-name">{name}</span></span>
        <div class="segmented" role="group" aria-label={name}>
          {states.map((state) => (
            <button key={state} class={value === state ? 'is-on' : ''} aria-pressed={value === state}
              data-testid={`${prefix}sensor-toggle-${name}-${state}`} onClick={() => sim.setSensor(name, state)}>{state}</button>
          ))}
        </div>
      </div>
    );
  }
  const { min, max, step } = sliderRange(sensor);
  return (
    <label class="control">
      <span class="control-label">
        <span class="control-name">{name}</span>
        <span class="control-value">{value}{unit ? ` ${unit}` : ''}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} data-testid={`${prefix}sensor-slider-${name}`}
        onInput={(e) => sim.setSensor(name, Number(e.currentTarget.value))} />
    </label>
  );
}

/** Sensors sit under the room they belong to, and the clock has its own group. */
export function Controls({ sim, object, id }: { sim: Simulation; object: ObjectFile; id: string }) {
  const prefix = id === 'output' ? '' : `${id}-`;
  const { sensors } = sim.state;
  const rooms = [...object.rooms, undefined].filter((room) => sensors.some((s) => s.room === room));
  return (
    <div class="controls" data-testid={`${prefix}controls`}>
      <div class="control-rooms">
        {rooms.map((room) => (
          <section key={room ?? 'none'} class="control-room">
            <h4>{room ? roomTitle(room) : 'Other'}</h4>
            {sensors.filter((s) => s.room === room).map((sensor) => (
              <SensorControl key={sensor.name} sensor={sensor} sim={sim} prefix={prefix} />
            ))}
          </section>
        ))}
        <section class="control-room">
          <h4>Clock</h4>
          <label class="control">
            <span class="control-label">
              <span class="control-name">TIME</span>
              <span class="control-value" data-testid={`${prefix}time-value`}>{formatMinutes(sim.state.minutes)}</span>
            </span>
            <input type="range" min={0} max={1439} step={1} value={sim.state.minutes} data-testid={`${prefix}time-slider`}
              onInput={(e) => sim.setTime(Number(e.currentTarget.value))} />
          </label>
          <label class="control-day">
            <span class="control-name">DAY</span>
            <select value={sim.state.day} onChange={(e) => sim.setDay(e.currentTarget.value)}>
              {DAYS.map((day) => <option key={day}>{day}</option>)}
            </select>
          </label>
        </section>
      </div>
    </div>
  );
}
