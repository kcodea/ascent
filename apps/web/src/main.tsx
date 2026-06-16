import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from '@game/ui';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
