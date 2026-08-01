import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DialogHost } from './dialog.js';
import './theme.css';
import './app.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
    <DialogHost />
  </StrictMode>,
);
