// Presentation-side sport config (emoji, log-flow limits, pain region lists,
// week-view border classes). Kept out of the seed catalogs on purpose: these
// are UI concerns, not load-model data.
export const SPORT_UI = {
  bouldering: { emoji: '🧗', maxDur: 240, durStep: 15, painRegions: ['fingers', 'forearm', 'elbow', 'shoulder'], border: 'b-boulder' },
  mountain_day: { emoji: '⛰️', maxDur: 720, durStep: 30, painRegions: ['knee', 'quads', 'calves', 'lower_back'], border: 'b-mountain' },
  running: { emoji: '🏃', maxDur: 300, durStep: 15, painRegions: ['knee', 'calves', 'quads', 'lower_back'], border: 'b-run' },
  strength: { emoji: '🏋️', maxDur: 180, durStep: 15, painRegions: null, border: 'b-strength' },
  gravel_cycling: { emoji: '🚴', maxDur: 480, durStep: 30, painRegions: ['knee', 'lower_back', 'quads', 'forearm'], border: 'b-cycle' },
};

export const sportUi = (id) => SPORT_UI[id] ?? { emoji: '•', maxDur: 180, durStep: 15, painRegions: ['knee', 'shoulder'], border: '' };
