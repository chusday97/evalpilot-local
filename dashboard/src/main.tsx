import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyProjectFirstLanding } from './project-first-route.js';
import './styles.css';
import './modal.css';

applyProjectFirstLanding();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
