import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './state/store';
import './styles/tokens.css';
import './styles/app.css';

// The live store for end-to-end tests and the developer console (read-only intent; no secrets live here).
Object.defineProperty(window, '__mp', { get: () => useStore.getState() });

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
