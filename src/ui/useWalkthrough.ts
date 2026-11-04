import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { failedStage, type CompileResult, type StageName } from '../compiler/index';

/** How long a finished stage stays on screen before Play moves on. */
const DWELL_MS = 1400;

export interface Walkthrough {
  current: StageName | null;
  /** Changes each time a stage should start its animation. */
  run: number;
  playing: boolean;
  canPrev: boolean;
  canNext: boolean;
  prev: () => void;
  next: () => void;
  togglePlay: () => void;
  /** Each stage calls this when its animation ends. */
  finish: () => void;
  stop: () => void;
}

/**
 * Takes the class through the stages in order. The stages themselves own their
 * animations; this only says whose turn it is, and moves on when told it ended.
 * It never goes past a failed stage, because nothing after it ran. Until it
 * starts, `viewing` (the stage on screen) is where Next and Play begin.
 */
export function useWalkthrough(result: CompileResult, viewing: number, onMove: (stage: StageName) => void): Walkthrough {
  const [index, setIndex] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stages = result.stages;
  const failed = failedStage(result);
  const lastIndex = failed ? stages.indexOf(failed) : stages.length - 1;

  const latest = useRef({ index, playing, lastIndex, stages, onMove });
  latest.current = { index, playing, lastIndex, stages, onMove };

  const go = useCallback((target: number) => {
    const stage = latest.current.stages[target]!.stage;
    clearTimeout(dwell.current);
    setIndex(target);
    setRun((n) => n + 1);
    latest.current.onMove(stage);
  }, []);

  const finish = useCallback(() => {
    const { playing: isPlaying, index: at, lastIndex: end } = latest.current;
    if (!isPlaying || at === null) return;
    clearTimeout(dwell.current);
    if (at >= end) {
      setPlaying(false);
      return;
    }
    dwell.current = setTimeout(() => go(at + 1), DWELL_MS);
  }, [go]);

  const stop = useCallback(() => {
    clearTimeout(dwell.current);
    setPlaying(false);
    setIndex(null);
  }, []);

  useEffect(() => () => clearTimeout(dwell.current), []);

  const from = Math.min(Math.max(0, viewing), lastIndex);
  return {
    current: index === null ? null : stages[index]!.stage,
    run, playing, finish, stop,
    canPrev: (index ?? from) > 0,
    canNext: index === null || index < lastIndex,
    prev: () => {
      setPlaying(false);
      const at = index ?? from;
      if (at > 0) go(at - 1);
    },
    next: () => {
      setPlaying(false);
      go(index === null ? from : Math.min(index + 1, lastIndex));
    },
    togglePlay: () => {
      if (playing) {
        clearTimeout(dwell.current);
        setPlaying(false);
        return;
      }
      setPlaying(true);
      latest.current.playing = true;
      go(index === null ? from : index >= lastIndex ? 0 : index + 1);
    },
  };
}
