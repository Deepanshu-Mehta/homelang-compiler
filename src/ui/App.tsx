import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  compile, stageResult, type CompileOptions, type LexerOutput, type StageResult,
} from '../compiler/index';
import { Card, SkippedNote } from './Card';
import { DomainCard } from './cards/DomainCard';
import { LexerCard } from './cards/LexerCard';
import { ParserCard } from './cards/ParserCard';
import { SemanticCard } from './cards/SemanticCard';
import { Editor, type LoadedText } from './Editor';
import { OutputPane } from './OutputPane';
import { PipelineBar } from './PipelineBar';
import { PRESETS } from './presets';

const DEBOUNCE_MS = 200;

const CARD_INTROS: Record<string, string> = {
  ir: 'Lowers each rule to simple three-address instructions, with AND and OR turned into jumps.',
  optimizer: 'Rewrites the instructions into fewer, faster ones without changing what the program does.',
  codegen: 'Turns the instructions into bytecode for a small stack machine.',
  simulation: 'Runs the bytecode against a simulated home.',
};

function PendingCard({ stage }: { stage: StageResult }) {
  return (
    <Card id={stage.stage} badge={String(stage.number)} title={stage.title}
      intro={CARD_INTROS[stage.stage] ?? ''} status={stage.status}>
      <SkippedNote stage={stage} />
    </Card>
  );
}

export function App() {
  const [source, setSource] = useState(PRESETS[0]!.source);
  const [loaded, setLoaded] = useState<LoadedText>({ text: source });
  const [presetId, setPresetId] = useState('');
  const [collectAllErrors, setCollectAllErrors] = useState(false);
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

  const lexerStage = stageResult(result, 'lexer');
  const tokens = (lexerStage.output as LexerOutput | null)?.tokens ?? [];
  const diagnostics = useMemo(() => result.stages.flatMap((s) => s.diagnostics), [result]);

  function loadPreset(id: string) {
    setPresetId(id);
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setSource(preset.source);
    setLoaded({ text: preset.source });
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
            tokens={tokens} diagnostics={diagnostics} highlightLine={null} />
          <div class="editor-foot">
            <span data-testid="char-count">{source.length} characters</span>
            <span>Compiles as you type</span>
          </div>
          <OutputPane result={result} />
        </aside>
        <div class="right-pane">
          <PipelineBar stages={result.stages} />
          <div class="cards">
            <DomainCard />
            <LexerCard stage={lexerStage} source={result.source} />
            <ParserCard stage={stageResult(result, 'parser')} source={result.source} tokens={tokens}
              collectAll={collectAllErrors} onCollectAll={setCollectAllErrors} />
            <SemanticCard stage={stageResult(result, 'semantic')} source={result.source} />
            {result.stages.slice(3).map((stage) => <PendingCard key={stage.stage} stage={stage} />)}
          </div>
        </div>
      </main>
    </div>
  );
}
