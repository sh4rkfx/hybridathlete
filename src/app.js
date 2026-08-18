// Bootstrap: open DB, seed on first run, load engine state, mount the UI.
import { html, render } from './ui/html.js';
import { App } from './ui/App.js';
import * as store from './ui/store.js';
import { updateWatcher } from './ui/swUpdate.js';

const mount = document.getElementById('app');
render(html`<${App} />`, mount);

store.boot().catch((e) => {
  console.error('boot failed', e);
  mount.innerHTML = '<div style="color:#FF6188;padding:24px;font-family:sans-serif">Start fehlgeschlagen: ' + e.message + '</div>';
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Read the controller before registering: after register() resolves on a
  // first visit it may already be set, and the watcher must know whether this
  // load came out of a cache or off the network. See ui/swUpdate.js.
  const watcher = updateWatcher({ wasControlled: !!navigator.serviceWorker.controller });
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, watcher.noteInteraction, { once: true, capture: true });
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (watcher.controllerChanged()) location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional in dev */ });
}
