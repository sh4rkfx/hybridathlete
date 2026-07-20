import { html } from './html.js';
import { acwr } from '../engine/acwr.js';
import { wdShort, isSameDay } from '../engine/time.js';
import { REGION_LABELS, FAT_LABELS, ACWR_CHIP_LABEL } from '../engine/texts.js';
import { catalogOf } from '../engine/catalog.js';
import { sportUi, SportGlyph } from './sportsUi.js';
import { nextLoggable, currentRegionStatus, upcomingSessions, ridgeData, MONTHS, zoneWording, needsOnboarding } from './helpers.js';

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

export function HomeScreen({ state, now, onLog, onCheckin, onAcwr, onGoWeek, onAdd, onRegenerate }) {
  const cat = catalogOf(state);
  const a = acwr(state.logs, now);
  const { zone, word: zoneWord, ratioLabel } = zoneWording(a);
  const next = nextLoggable(state, now);
  const regs = currentRegionStatus(state, now);
  const up = upcomingSessions(state, now);
  const onboarding = needsOnboarding(state);

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
    ${!onboarding && next ? html`
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
    <button class="ghost-cta" onClick=${onCheckin}>
      <div style="text-align:left"><div class="g-k">Guten Morgen</div><div>Check-in · 30 Sekunden</div></div>
      <span>→</span>
    </button>
    <div class="sec-title"><h3>Erholung heute</h3></div>
    <div class="region-strip">
      ${regs.map((x) => html`<span class="rpill"><span class="mark m-${x.level}"></span>${REGION_LABELS[x.r]} · ${FAT_LABELS[x.level]}</span>`)}
    </div>
    ${up.length ? html`<div class="sec-title"><h3>Diese Woche</h3><button class="link" onClick=${onGoWeek}>Alle ansehen</button></div>` : ''}
    ${up.map((p) => {
      const ui = sportUi(p.sportId);
      const cls = (p.fixed ? 'fixed ' : '') + (p.status === 'removed' ? 'removed ' : '') + (p.loggedId ? 'done ' : '');
      return html`<div class="mini-card ${cls}">
        <span class="mc-emoji"><${SportGlyph} id=${p.sportId} size=${22} /></span>
        <div class="mc-body"><div class="mc-t">${cat.sports[p.sportId].name}${p.unit ? ' · ' + p.unit : ''} ${p.reduced ? html`<span class="tag-reduced">reduziert</span>` : ''}</div>
        <div class="mc-s">${wdShort(p.date)} · ${new Date(p.date).getHours()}:00${p.status === 'removed' ? ' · gestrichen' : ''}</div></div>
        ${p.fixed ? html`<span class="pin">📌 fix</span>` : ''}
      </div>`;
    })}
    <div class="proto-note">HYBRIDATHLETE · lokale Daten · Engine: T01–T17 grün</div>`;
}
