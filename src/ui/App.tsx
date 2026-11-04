import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  compile, failedStage, stageOutput, stageResult, type CompileOptions, type CompileResult,
  type LexerOutput, type ObjectFile, type StageName,
} from '../compiler/index';
import { FocusContext } from './Card';
import { CodegenCard } from './cards/CodegenCard';
import { Primer } from './cards/DomainCard';
import { IrCard } from './cards/IrCard';
import { LexerCard } from './cards/LexerCard';
import { OptimizerCard } from './cards/OptimizerCard';
import { ParserCard } from './cards/ParserCard';
import { SemanticCard } from './cards/SemanticCard';
import { SimulationCard } from './cards/SimulationCard';
import { Editor, type LoadedText } from './Editor';
import { NextIcon, PrevIcon } from './icons';
import { ResultPanel } from './OutputPane';
import { PipelineBar } from './PipelineBar';
import { PRESETS } from './presets';
import { scrollToTop } from './scroll';
import { SpanLink } from './SpanLink';
import type { SourceSpan } from './trees';
import { useSimulation } from './useSimulation';
import { useWalkthrough } from './useWalkthrough';

const DEBOUNCE_MS = 200;
/** Half-typed code is usually broken, so a new failure waits a little longer. */
const FAILURE_GRACE_MS = 500;

/** What the right pane shows: one stage, or the primer. */
export type View = StageName | 'domain';

/** Keys a presenter's clicker or a keyboard sends to move between stages. */
const NEXT_KEYS = new Set(['ArrowRight', 'PageDown']);
const PREV_KEYS = new Set(['ArrowLeft', 'PageUp']);

/** Arrow keys belong to whatever is being typed in or adjusted. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
    || target.closest('.cm-editor') !== null;
}

export function App() {
  const [source, setSource] = useState(PRESETS[0]!.source);
  const [loaded, setLoaded] = useState<LoadedText>({ text: source });
  const [presetId, setPresetId] = useState('');
  const [collectAllErrors, setCollectAllErrors] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [view, setView] = useState<View>('lexer');
  const [hoverSpan, setHoverSpan] = useState<SourceSpan | null>(null);
  const [picked, setPicked] = useState<{ position: number; source: string } | null>(null);
  const options: CompileOptions = useMemo(() => ({ collectAllErrors }), [collectAllErrors]);
  const [result, setResult] = useState<CompileResult>(() => compile(source, options));
  const compiledWith = useRef(options);
  const resultRef = useRef(result);
  resultRef.current = result;

  /** Set when an example loads, so the page can move to where it matters. */
  const showAfterLoad = useRef(false);

  useEffect(() => {
    if (source === resultRef.current.source && options === compiledWith.current) return undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      compiledWith.current = options;
      const next = compile(source, options);
      if (failedStage(next) && !failedStage(resultRef.current)) {
        grace = setTimeout(() => setResult(next), FAILURE_GRACE_MS);
      } else {
        setResult(next);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(grace);
    };
  }, [source, options]);

  // While typing, the home stays on screen even if the code is briefly broken.
  const lastGoodObject = useRef<ObjectFile | null>(null);
  const object = stageOutput(result, 'codegen');
  if (object) lastGoodObject.current = object;
  const shownObject = object ?? lastGoodObject.current;
  const sim = useSimulation(shownObject);

  const lexerStage = stageResult(result, 'lexer');
  const tokens = (lexerStage.output as LexerOutput | null)?.tokens ?? [];
  const diagnostics = useMemo(() => result.stages.flatMap((s) => s.diagnostics), [result]);

  /** Shows a stage (or the primer) and starts it from the top. */
  const show = useCallback((next: View) => {
    setView(next);
    setFocused((current) => (current && next !== 'domain' ? next : current));
    scrollToTop();
  }, []);

  useEffect(() => {
    if (!showAfterLoad.current) return;
    showAfterLoad.current = false;
    const failed = failedStage(result);
    if (failed) show(failed.stage);
  }, [result, show]);

  function loadPreset(id: string) {
    setPresetId(id);
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    lastGoodObject.current = null;
    showAfterLoad.current = true;
    setSource(preset.source);
    setLoaded({ text: preset.source });
    // Debouncing is for typing; an example can show its result straight away.
    setResult(compile(preset.source, options));
  }

  const stageNames = result.stages.map((s) => s.stage);
  const at = view === 'domain' ? -1 : stageNames.indexOf(view);
  const walk = useWalkthrough(result, at, show);
  const { current, run, finish, stop } = walk;

  /** A person choosing a stage takes over from the walkthrough. */
  const navigate = useCallback((next: View) => {
    stop();
    show(next);
  }, [stop, show]);

  // Editing changes what the stages show, so the walkthrough ends there.
  const walkedSource = useRef(source);
  useEffect(() => {
    if (walkedSource.current !== source) {
      walkedSource.current = source;
      stop();
    }
  }, [source, stop]);

  const prevStage = at > 0 ? result.stages[at - 1] : undefined;
  const nextStage = at < stageNames.length - 1 ? result.stages[at + 1] : undefined;

  // A clicker or the arrow keys move between stages, unless someone is typing.
  const keyNav = useRef({ prevStage, nextStage, navigate });
  keyNav.current = { prevStage, nextStage, navigate };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTyping(event.target)) return;
      const nav = keyNav.current;
      const target = NEXT_KEYS.has(event.key) ? nav.nextStage : PREV_KEYS.has(event.key) ? nav.prevStage : undefined;
      if (!target) return;
      event.preventDefault();
      nav.navigate(target.stage);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const focusState = useMemo(() => ({ focused, setFocused, current, run, finish, view }), [focused, current, run, finish, view]);
  // A position only means something for the text it was picked in.
  const pickedPosition = picked?.source === result.source ? picked.position : null;
  const spanLink = useMemo(() => ({ setHoverSpan, pickedPosition }), [pickedPosition]);

  const preset = PRESETS.find((p) => p.id === (presetId || PRESETS[0]!.id));
  const fileName = `${preset?.id ?? 'program'}.home`;
  const edited = preset !== undefined && preset.source !== source;

  return (
    <FocusContext.Provider value={focusState}>
      <SpanLink.Provider value={spanLink}>
      <div class="app">
        <PipelineBar stages={result.stages} walk={walk} view={view} onShow={navigate} />
        <main class="layout">
          <aside class="left-pane" aria-label="Source program">
            <header class="program-head">
              <h2 class="file-name">
                <span class="visually-hidden">Source program: </span>{fileName}
                {edited && <span class="file-edited">edited</span>}
              </h2>
              <select class="preset-select" value={presetId} data-testid="preset-select"
                aria-label="Load an example" onChange={(e) => loadPreset(e.currentTarget.value)}>
                <option value="">Load an example…</option>
                {(['Valid programs', 'Deliberate errors'] as const).map((group) => (
                  <optgroup key={group} label={group}>
                    {PRESETS.filter((p) => p.group === group).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </header>
            <Editor loaded={loaded} onChange={setSource} compiledSource={result.source}
              tokens={tokens} diagnostics={diagnostics} highlightLine={highlightLine} span={hoverSpan}
              onPick={(position) => setPicked({ position, source })} />
            <div class="editor-foot">
              <span data-testid="char-count">{source.length} characters</span>
              <span>Compiles as you type</span>
            </div>
            <ResultPanel result={result} sim={sim} object={shownObject} onShow={navigate} />
          </aside>
          <div class="right-pane">
            <Primer open={view === 'domain'} onClose={() => navigate('lexer')} />
            <div class="stages">
              <LexerCard stage={lexerStage} source={result.source} />
              <ParserCard stage={stageResult(result, 'parser')} source={result.source} tokens={tokens}
                collectAll={collectAllErrors} onCollectAll={setCollectAllErrors} />
              <SemanticCard stage={stageResult(result, 'semantic')} source={result.source}
                onLoadWitness={(witness) => {
                  sim?.loadWitness(witness);
                  navigate('simulation');
                }} />
              <IrCard stage={stageResult(result, 'ir')} />
              <OptimizerCard stage={stageResult(result, 'optimizer')} />
              <CodegenCard stage={stageResult(result, 'codegen')} />
              <SimulationCard stage={stageResult(result, 'simulation')} sim={sim} object={shownObject} onLine={setHighlightLine} />
            </div>
            {view !== 'domain' && (
              <nav class="stage-pager" aria-label="Previous and next stage">
                {prevStage
                  ? <button class="pager-link" data-testid="pager-prev" onClick={() => navigate(prevStage.stage)}>
                      <PrevIcon /> <span><span class="pager-hint">Previous</span>Stage {prevStage.number} · {prevStage.title}</span>
                    </button>
                  : <span />}
                {nextStage && (
                  <button class="pager-link is-next" data-testid="pager-next" onClick={() => navigate(nextStage.stage)}>
                    <span><span class="pager-hint">Next</span>Stage {nextStage.number} · {nextStage.title}</span> <NextIcon />
                  </button>
                )}
              </nav>
            )}
          </div>
        </main>
      </div>
      </SpanLink.Provider>
    </FocusContext.Provider>
  );
}
