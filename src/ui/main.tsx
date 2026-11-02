import { render } from 'preact';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/atkinson-hyperlegible-mono';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';

render(<App />, document.getElementById('app')!);
