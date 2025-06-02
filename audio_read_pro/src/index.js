import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

/* PDF.js worker initialization now handled in App.js */

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
