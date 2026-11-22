import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';
import { MapView } from './map/MapView';

render(<App Map={MapView} />, document.getElementById('app')!);
