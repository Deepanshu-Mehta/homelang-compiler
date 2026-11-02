import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  createSession, type ObjectFile, type Session, type SimulatorState, type Value, type WitnessValue,
} from '../compiler/index';

export type Speed = 1 | 10 | 60;

export interface Simulation {
  session: Session;
  state: SimulatorState;
  playing: boolean;
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  togglePlay: () => void;
  step: () => void;
  reset: () => void;
  setSensor: (name: string, value: Value) => void;
  setTime: (minutes: number) => void;
  setDay: (day: string) => void;
  loadWitness: (witness: readonly WitnessValue[]) => void;
}

/** One live session for each compiled program, shared by both floor plans. */
export function useSimulation(object: ObjectFile | null): Simulation | null {
  const [generation, setGeneration] = useState(0);
  const [, redraw] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const session = useMemo(() => (object ? createSession(object) : null), [object, generation]);
  const refresh = useCallback(() => redraw((n) => n + 1), []);

  useEffect(() => setPlaying(false), [session]);

  useEffect(() => {
    if (!playing || !session) return undefined;
    const timer = setInterval(() => {
      session.step();
      if (session.finished) setPlaying(false);
      refresh();
    }, 1000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, session, refresh]);

  if (!session) return null;

  const act = (change: () => void) => {
    change();
    refresh();
  };

  return {
    session, state: session.state, playing, speed, setSpeed,
    togglePlay: () => setPlaying(!playing),
    step: () => act(() => session.step()),
    reset: () => setGeneration((n) => n + 1),
    setSensor: (name, value) => act(() => session.setSensor(name, value)),
    setTime: (minutes) => act(() => session.setTime(minutes)),
    setDay: (day) => act(() => session.setDay(day)),
    loadWitness: (witness) => act(() => {
      const sensors = new Set(session.state.sensors.map((s) => s.name));
      for (const { variable, value } of witness) {
        if (variable === 'TIME') session.setTime(value as number);
        else if (variable === 'DAY') session.setDay(value as string);
        else if (sensors.has(variable)) session.setSensor(variable, value);
      }
    }),
  };
}
