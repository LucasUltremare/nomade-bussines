import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
/* Importado ANTES de montar o React: o `beforeinstallprompt` costuma disparar
   antes do primeiro render, e quem não escuta a tempo perde o evento — aí o
   botão "Instalar" nunca aparece. Ver src/lib/pwa.js. */
import { registrarSW } from './lib/pwa.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

registrarSW();
