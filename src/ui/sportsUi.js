// Presentation-side sport config (glyphs, log-flow limits, pain region lists,
// week-view border classes). Kept out of the seed catalogs on purpose: these
// are UI concerns, not load-model data.
import { html } from './html.js';

// Own SVG sport glyphs (story #35): consistent across platforms, drawn in the
// stroke style of the tab icons instead of OS-dependent emoji.
const GLYPH_PATHS = {
  bouldering: html`<path d="M3 7h14M6 7v4.5M10 7v6M14 7v4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  mountain_day: html`<path d="M2 16L7.5 5l3 5.5L13.5 6 18 16H2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>`,
  running: html`<path d="M2 13.5h3.5l2.5-6 3 8 2.5-5H17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M14.5 16.5H18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  strength: html`<rect x="2" y="6.5" width="3" height="7" rx="1" fill="currentColor"/><rect x="15" y="6.5" width="3" height="7" rx="1" fill="currentColor"/><path d="M5 10h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  gravel_cycling: html`<circle cx="5.5" cy="13" r="3.5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="14.5" cy="13" r="3.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M5.5 13l3-6.5h5L14.5 13M8.5 6.5H6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
};

export function SportGlyph({ id, size = 18 }) {
  const p = GLYPH_PATHS[id];
  if (!p) return html`<span aria-hidden="true">•</span>`;
  return html`<svg width=${size} height=${size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style="vertical-align:-3px">${p}</svg>`;
}
export const SPORT_UI = {
  bouldering: { emoji: '🧗', maxDur: 240, durStep: 15, painRegions: ['fingers', 'forearm', 'elbow', 'shoulder'], border: 'b-boulder' },
  mountain_day: { emoji: '⛰️', maxDur: 720, durStep: 30, painRegions: ['knee', 'quads', 'calves', 'lower_back'], border: 'b-mountain' },
  running: { emoji: '🏃', maxDur: 300, durStep: 15, painRegions: ['knee', 'calves', 'quads', 'lower_back'], border: 'b-run' },
  strength: { emoji: '🏋️', maxDur: 180, durStep: 15, painRegions: null, border: 'b-strength' },
  gravel_cycling: { emoji: '🚴', maxDur: 480, durStep: 30, painRegions: ['knee', 'lower_back', 'quads', 'forearm'], border: 'b-cycle' },
};

export const sportUi = (id) => SPORT_UI[id] ?? { emoji: '•', maxDur: 180, durStep: 15, painRegions: ['knee', 'shoulder'], border: '' };
