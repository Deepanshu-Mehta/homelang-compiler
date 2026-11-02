import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  compile, failedStage, stageOutput, stageResult, type CompileOptions, type CompileResult,
  type LexerOutput, type ObjectFile,
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
import { OutputPane } from './OutputPane';
import { PipelineBar } from './PipelineBar';
import { PRESETS } from './presets';
import { scrollToCard, scrollToTop } from './scroll';
import { useSimulation } from './useSimulation';

const DEBOUNCE_MS = 200;
/** Half-typed code is usually broken, so a new failure waits a little longer. */
const FAILURE_GRACE_MS = 500;

export function App() {
  const [source, setSource] = useState(PRESETS[0]!.source);
  const [loaded, setLoaded] = useState<LoadedText>({ text: source });
  const [presetId, setPresetId] = useState('');
  const [collectAllErrors, setCollectAllErrors] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const options: CompileOptions = useMemo(() => ({ collectAllErrors }), [collectAllErrors]);
  const [result, setResult] = useState<CompileResult>(() => compile(source, options));
  const compiledWith = useRef(options);
  const resultRef = useRef(result);
  resultRef.current = result;

  /** Set when an example loads, so the page can move to where it matters. */
  const scrollAfterLoad = useRef(false);

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

  useEffect(() => {
    if (!scrollAfterLoad.current) return;
    scrollAfterLoad.current = false;
    const failed = failedStage(result);
    if (failed) scrollToCard(failed.stage);
    else scrollToTop();
  }, [result]);

  function loadPreset(id: string) {
    setPresetId(id);
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    lastGoodObject.current = null;
    scrollAfterLoad.current = true;
    setSource(preset.source);
    setLoaded({ text: preset.source });
    // Debouncing is for typing; an example can show its result straight away.
    setResult(compile(preset.source, options));
  }

  const focusState = useMemo(() => ({ focused, setFocused, current: null }), [focused]);

  return (
    <FocusContext.Provider value={focusState}>
      <div class="app">
        <PipelineBar stages={result.stages} current={null} />
        <main class="layout">
          <aside class="left-pane">
            <header class="pane-head">
              <h2>Source program</h2>
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
              tokens={tokens} diagnostics={diagnostics} highlightLine={highlightLine} />
            <div class="editor-foot">
              <span data-testid="char-count">{source.length} characters</span>
              <span>Compiles as you type</span>
            </div>
            <OutputPane result={result} sim={sim} object={shownObject} onLine={setHighlightLine} />
          </aside>
          <div class="right-pane">
            <Primer />
            <div class="stages">
              <LexerCard stage={lexerStage} source={result.source} />
              <ParserCard stage={stageResult(result, 'parser')} source={result.source} tokens={tokens}
                collectAll={collectAllErrors} onCollectAll={setCollectAllErrors} />
              <SemanticCard stage={stageResult(result, 'semantic')} source={result.source}
                onLoadWitness={(witness) => sim?.loadWitness(witness)} />
              <IrCard stage={stageResult(result, 'ir')} />
              <OptimizerCard stage={stageResult(result, 'optimizer')} />
              <CodegenCard stage={stageResult(result, 'codegen')} />
              <SimulationCard stage={stageResult(result, 'simulation')} sim={sim} object={shownObject} onLine={setHighlightLine} />
            </div>
          </div>
        </main>
      </div>
    </FocusContext.Provider>
  );
}
