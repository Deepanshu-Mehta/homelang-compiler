import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  compile, stageOutput, stageResult, type CompileOptions, type LexerOutput,
} from '../compiler/index';
import { CodegenCard } from './cards/CodegenCard';
import { DomainCard } from './cards/DomainCard';
import { IrCard } from './cards/IrCard';
import { LexerCard } from './cards/LexerCard';
import { OptimizerCard } from './cards/OptimizerCard';
import { ParserCard } from './cards/ParserCard';
import { SimulationCard } from './cards/SimulationCard';
import { SemanticCard } from './cards/SemanticCard';
import { Editor, type LoadedText } from './Editor';
import { OutputPane } from './OutputPane';
import { PipelineBar } from './PipelineBar';
import { PRESETS } from './presets';
import { useSimulation } from './useSimulation';

const DEBOUNCE_MS = 200;

export function App() {
  const [source, setSource] = useState(PRESETS[0]!.source);
  const [loaded, setLoaded] = useState<LoadedText>({ text: source });
  const [presetId, setPresetId] = useState('');
  const [collectAllErrors, setCollectAllErrors] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const options: CompileOptions = useMemo(() => ({ collectAllErrors }), [collectAllErrors]);
  const [result, setResult] = useState(() => compile(source, options));
  const compiledWith = useRef(options);

  useEffect(() => {
    if (source === result.source && options === compiledWith.current) return undefined;
    const timer = setTimeout(() => {
      compiledWith.current = options;
      setResult(compile(source, options));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // result.source only tells us whether a compile is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, options]);

  // The simulation runs the last program that compiled through code generation.
  const object = stageOutput(result, 'codegen');
  const sim = useSimulation(object);

  const lexerStage = stageResult(result, 'lexer');
  const tokens = (lexerStage.output as LexerOutput | null)?.tokens ?? [];
  const diagnostics = useMemo(() => result.stages.flatMap((s) => s.diagnostics), [result]);

  function loadPreset(id: string) {
    setPresetId(id);
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setSource(preset.source);
    setLoaded({ text: preset.source });
    // Debouncing is for typing; a preset can show its result straight away.
    setResult(compile(preset.source, options));
  }

  return (
    <div class="app">
      <header class="app-header">
        <h1>Let's Automate a Home</h1>
        <p>a compiler for smart homes</p>
      </header>
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
          <OutputPane result={result} sim={sim} object={object} onLine={setHighlightLine} />
        </aside>
        <div class="right-pane">
          <PipelineBar stages={result.stages} />
          <div class="cards">
            <DomainCard />
            <LexerCard stage={lexerStage} source={result.source} />
            <ParserCard stage={stageResult(result, 'parser')} source={result.source} tokens={tokens}
              collectAll={collectAllErrors} onCollectAll={setCollectAllErrors} />
            <SemanticCard stage={stageResult(result, 'semantic')} source={result.source} onLoadWitness={(witness) => sim?.loadWitness(witness)} />
            <IrCard stage={stageResult(result, 'ir')} />
            <OptimizerCard stage={stageResult(result, 'optimizer')} />
            <CodegenCard stage={stageResult(result, 'codegen')} />
            <SimulationCard stage={stageResult(result, 'simulation')} sim={sim} object={object} onLine={setHighlightLine} />
          </div>
        </div>
      </main>
    </div>
  );
}
