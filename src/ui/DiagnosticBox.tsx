import type { Diagnostic, Severity } from '../compiler/index';
import { CrossIcon, InfoIcon, WarnIcon } from './icons';

const SEVERITY_WORD: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Note' };

export function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === 'error') return <CrossIcon />;
  if (severity === 'warning') return <WarnIcon />;
  return <InfoIcon />;
}

/** The source line with a caret under the offending column. */
export function ErrorBox({ diagnostic, source }: { diagnostic: Diagnostic; source: string }) {
  const lines = source.split('\n');
  const text = (lines[diagnostic.span.line - 1] ?? '').replace(/\r$/, '');
  const gutter = `line ${diagnostic.span.line}`;
  return (
    <div class={`error-box sev-${diagnostic.severity}`} data-code={diagnostic.code}>
      <p class="error-title">
        <strong><SeverityIcon severity={diagnostic.severity} /> {SEVERITY_WORD[diagnostic.severity]} {diagnostic.code}</strong>
        <span>{diagnostic.message}</span>
      </p>
      <pre class="caret-view">
        <span class="caret-gutter">{gutter}</span>
        <span class="caret-rule"> │ </span>{text}{'\n'}
        <span class="caret-gutter">{' '.repeat(gutter.length)}</span>
        <span class="caret-rule"> │ </span>{' '.repeat(Math.max(0, diagnostic.span.col - 1))}<span class="caret">^</span>
      </pre>
      <p class="error-hint">{diagnostic.hint}</p>
    </div>
  );
}

export function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }) {
  const { code, severity, message, hint, span } = diagnostic;
  return (
    <li class={`diagnostic sev-${severity}`} data-code={code}>
      <span class="diagnostic-icon" aria-label={SEVERITY_WORD[severity]}><SeverityIcon severity={severity} /></span>
      <span class="diagnostic-code">{code}</span>
      <span class="diagnostic-where">line {span.line}, col {span.col}</span>
      <span class="diagnostic-message">{message}</span>
      <span class="diagnostic-hint">{hint}</span>
    </li>
  );
}
