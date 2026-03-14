/**
 * 蜂群控制台入口 / Swarm Console Entry Point
 *
 * @module console/main
 * @author DEEP-IOS
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/variables.css';
import './styles/global.css';

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
