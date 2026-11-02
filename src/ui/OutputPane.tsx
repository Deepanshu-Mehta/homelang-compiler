import { failedStage, type CompileResult } from '../compiler/index';
import { scrollToCard } from './scroll';

export function OutputPane({ result }: { result: CompileResult }) {
  const failed = failedStage(result);
  return (
    <section class="output" data-testid="output">
      <header class="pane-head">
        <h2>Output</h2>
        <span class="pane-note">{failed ? 'STOPPED' : 'COMPILED'}</span>
      </header>
      {failed && (
        <div class="stopped-box" data-testid="stopped-box">
          <p class="stopped-title">Stopped at stage {failed.number}: {failed.title}</p>
          <p>{failed.diagnostics.find((d) => d.severity === 'error')?.message}</p>
          <button class="link-button" onClick={() => scrollToCard(failed.stage)}>Show the error</button>
        </div>
      )}
    </section>
  );
}
