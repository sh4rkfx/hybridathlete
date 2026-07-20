// Bootstrap: open DB, seed on first run, load engine state, mount the UI.
import { html, render } from './ui/html.js';
import { App } from './ui/App.js';
import * as store from './ui/store.js';

const mount = document.getElementById('app');
render(html`<${App} />`, mount);

store.boot().catch((e) => {
  console.error('boot failed', e);
  mount.innerHTML = '<div style="color:#FF6188;padding:24px;font-family:sans-serif">Start fehlgeschlagen: ' + e.message + '</div>';
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional in dev */ });
}
