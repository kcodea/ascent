import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from '@game/ui';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

// Disable the browser context menu — right-click does nothing in-game.
window.addEventListener('contextmenu', (e) => e.preventDefault());

createRoot(root).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
