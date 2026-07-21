import { html } from './html.js';
import { acwr } from '../engine/acwr.js';
import { wdShort, isSameDay } from '../engine/time.js';
import { REGION_LABELS, FAT_LABELS, ACWR_CHIP_LABEL } from '../engine/texts.js';
import { catalogOf } from '../engine/catalog.js';
import { SportGlyph } from './sportsUi.js';
import { nextLoggable, currentRegionStatus, ridgeData, MONTHS, zoneWording, needsOnboarding, checkinDoneToday } from './helpers.js';
import { prefillSets } from '../engine/progression.js';
import { exerciseReadiness } from '../engine/readiness.js';
import { GOAL_SCHEMES } from '../engine/catalog.js';

function Ridge({ state, now }) {
  const r = ridgeData(state, now);
  const tp = r.pts[r.todayIdx];
  return html`
    <div class="ridge-wrap">
      <svg viewBox="0 0 ${r.W} ${r.H}" preserveAspectRatio="none" aria-label="Wochenlast Höhenprofil">
        <defs>
          <linearGradient id="rf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C8F542" stop-opacity="0.22"/><stop offset="1" stop-color="#C8F542" stop-opacity="0"/></linearGradient>
          <linearGradient id="rs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C8F542"/><stop offset="1" stop-color="#34D6A6"/></linearGradient>
        </defs>
        <rect x="0" y=${r.top + 22} width=${r.W} height="40" fill="#34D6A6" opacity="0.14"/>
        <path d=${r.area} fill="url(#rf)"/>
        <path d=${r.line} fill="none" stroke="url(#rs)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx=${tp[0].toFixed(0)} cy=${tp[1].toFixed(0)} r="4.5" fill="#0E1320" stroke="#34D6A6" stroke-width="2.5"/>
      </svg>
    </div>
    <div class="ridge-days">
      ${r.days.map((d, i) => html`<span class=${i === r.todayIdx ? 'today' : ''}>${wdShort(d)}</span>`)}
    </div>`;
}

export function HomeScreen({ state, now, onLog, onCheckin, onAcwr, onAdd, onRegenerate, onReportFatigue }) {
  const cat = catalogOf(state);
  const a = acwr(state.logs, now);
  const { zone, word: zoneWord, ratioLabel } = zoneWording(a);
  const next = nextLoggable(state, now);
  const regs = currentRegionStatus(state, now);
  const onboarding = needsOnboarding(state);
  // Story #52: on a strength day the session ITSELF gets the attention —
  // exercises, readiness and prefilled loads (MyFitCoach-style), not just a
  // slim "log" button.
  const todayStrength = next && next.sportId === 'strength' && isSameDay(next.date, now) ? next : null;
  const fmtW = (w) => (Math.round(w * 100) / 100).toString().replace('.', ',');

  return html`
    <div class="home-top">
      <div class="brandmark">
        <span aria-hidden="true"><svg width="26" height="26" viewBox="0 0 26 26" fill="none"><rect x="2" y="8" width="4" height="10" rx="1.2" fill="#C8F542"/><rect x="20" y="8" width="4" height="10" rx="1.2" fill="#C8F542"/><path d="M6 13 L10 13 L12 8 L14 18 L16 13 L20 13" stroke="#EEF2FB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="name">HYBRID<b>ATHLETE</b></span>
      </div>
      <span class="daytag">${wdShort(now).toUpperCase()} · ${now.getDate()}. ${MONTHS[now.getMonth()]}</span>
    </div>
    <div class="ridge-card">
      <div class="rc-head">
        <div><div class="rc-label">Wochenlast</div><h2>${zoneWord}</h2></div>
        <button class="acwr-chip z-${zone}" onClick=${onAcwr} aria-label="Was ist ACWR?"><span class="v">${ratioLabel}</span><span class="l">${ACWR_CHIP_LABEL}</span></button>
      </div>
      <${Ridge} state=${state} now=${now} />
    </div>
    ${onboarding ? html`
      <div class="settings-card" style="margin-top:16px">
        <div class="f-lbl">Erste Woche planen</div>
        <p class="subtle" style="margin-bottom:12px">Noch nichts geplant. Lass den Generator einen Kraftplan bauen – oder leg direkt eine Einheit an. Fixe Termine (Boulderabend, Bergtag) markierst du mit 📌.</p>
        <button class="act-btn primary" onClick=${onRegenerate}>Kraftplan generieren</button>
        <button class="act-btn" onClick=${() => onAdd(0, 'evening')}>＋ Einheit planen</button>
      </div>` : ''}
    ${!onboarding && todayStrength ? html`
      <div class="workout-card">
        <div class="wo-head">
          <span class="wo-glyph"><${SportGlyph} id="strength" size=${22} /></span>
          <div><div class="wo-k">Heute geplant${todayStrength.fixed ? ' · 📌 fix' : ''}</div>
          <div class="wo-t">Kraft · ${todayStrength.unit ?? ''} <span class="wo-time">${new Date(todayStrength.date).getHours()}:00</span></div></div>
        </div>
        ${(todayStrength.exercises ?? []).map((id) => {
          const e = cat.exById[id];
          if (!e) return '';
          const r = exerciseReadiness(id, now, state, now);
          const pre = prefillSets(id, state, state.profile.goal);
          return html`<div class="wo-row">
            <span class="mark m-${r.level}" title=${r.reasons[0] || 'frei'}></span>
            <span class="wo-name">${e.name}</span>
            ${pre.source === 'advice' ? html`<span class="hint-chip ok">↑ +${fmtW(pre.deltaKg)}</span>` : ''}
            ${pre.source === 'fresh' ? html`<span class="hint-chip warn">erstes Mal</span>` : ''}
            <span class="wo-scheme">${pre.sets.length}× ${GOAL_SCHEMES[state.profile.goal].reps}${pre.sets[0].w > 0 ? ` · ${fmtW(pre.sets[0].w)} kg` : ''}</span>
          </div>`;
        })}
        <button class="cta-start" onClick=${() => onLog(todayStrength.id)}>Training starten</button>
      </div>` : ''}
    ${!onboarding && next && !todayStrength ? html`
      <button class="log-cta" onClick=${() => onLog(next.id)}>
        <div class="lc-left">
          <span class="lc-k">${isSameDay(next.date, now) ? 'Heute geplant' : wdShort(next.date) + ' geplant'}</span>
          <span class="lc-t">${cat.sports[next.sportId].name} loggen</span>
          <span class="lc-sub">${new Date(next.date).getHours()}:00${next.fixed ? ' · 📌 fix' : ''}${next.unit ? ' · ' + next.unit : ''}</span>
        </div>
        <span class="lc-icon" aria-hidden="true">+</span>
      </button>`
    : ''}
    ${!onboarding && !next ? html`<div class="mini-card" style="margin-top:16px"><span class="mc-emoji">✓</span><div class="mc-body"><div class="mc-t">Alles geloggt</div><div class="mc-s">Keine offene Einheit</div></div></div>` : ''}
    ${checkinDoneToday(state, now) ? html`
      <button class="ghost-cta" onClick=${onCheckin} style="border-color:rgba(52,214,166,.35)">
        <div style="text-align:left"><div class="g-k" style="color:var(--fresh)">✓ Check-in erledigt</div><div>Bis morgen – antippen zum Korrigieren</div></div>
        <span>→</span>
      </button>`
    : html`
      <button class="ghost-cta" onClick=${onCheckin}>
        <div style="text-align:left"><div class="g-k">Guten Morgen</div><div>Check-in · 30 Sekunden</div></div>
        <span>→</span>
      </button>`}
    <div class="sec-title"><h3>Erholung heute</h3></div>
    <div class="region-strip">
      ${regs.length
        ? regs.map((x) => html`<span class="rpill"><span class="mark m-${x.level}"></span>${REGION_LABELS[x.r]} · ${FAT_LABELS[x.level]}</span>`)
        : html`<span class="rpill"><span class="mark m-fresh"></span>Alles frisch – keine Einschränkungen</span>`}
      <button class="rpill" style="cursor:pointer" onClick=${onReportFatigue}>＋ melden</button>
    </div>
    <div class="proto-note">HYBRIDATHLETE · lokale Daten · Engine: T01–T17 grün</div>`;
}
