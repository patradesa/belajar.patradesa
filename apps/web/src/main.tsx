import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import { App } from './App';
import { SessionProvider } from './lib/session';
import { applyFontScale, readFontScale } from './lib/fontScale';

// Terapkan skala teks sebelum render pertama (hindari lompatan layout).
applyFontScale(readFontScale());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
