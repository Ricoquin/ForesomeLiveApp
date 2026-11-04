import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import TvMode from './features/community/TvMode.jsx';
import PublicEvent from './features/community/PublicEvent.jsx';
import './global.css';

// Public routes that work without signing in: /tv/:eventId (pro shop TV) and /e/:eventId (shareable event page)
const path = window.location.pathname;
const tv = path.match(/^\/tv\/([0-9a-f-]{36})/i);
const ev = path.match(/^\/e\/([0-9a-f-]{36})/i);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(tv ? <TvMode eventId={tv[1]} /> : ev ? <PublicEvent eventId={ev[1]} /> : <App />);
