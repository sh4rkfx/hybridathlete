// Post-session log flow (<60 s hero interaction, spec §6.2). Steps are
// sport-dependent: confirm -> effort (+hm for mountain) -> finger (bouldering)
// -> sets (strength) -> fatigue -> pain.
import { html } from './html.js';
import { useOverlayA11y } from './overlayA11y.js';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { wdShort } from '../engine/time.js';
import { REGION_LABELS, FAT_LABELS } from '../engine/texts.js';
import { catalogOf, GOAL_SCHEMES } from '../engine/catalog.js';
import { exerciseReadiness } from '../engine/readiness.js';
import { sportUi, SportGlyph } from './sportsUi.js';
import { rpeMeta, fmtDur } from './helpers.js';
import { prefillSets, incrementFor } from '../engine/progression.js';

const defaultDur = (sportId) => sportId === 'mountain_day' ? 360 : sportId === 'running' ? 45 : sportId === 'strength' ? 60 : 90;

function buildSteps(sportId, loadSource) {
  const steps = ['confirm', 'effort'];
  if (sportId === 'bouldering') steps.push('finger');
  if (loadSource === 'exercises') steps.push('sets');
  steps.push('fatigue', 'pain');
  return steps;
}

// Story #50: ctx.sets values are {included, sets:[{w,reps}], rir, ...} — only
// included exercises count towards regions.
const includedIds = (ctx) => Object.entries(ctx.sets).filter(([, c]) => c.included).map(([id]) => id);

function painRegionsFor(ctx, cat) {
  if (ctx.loadSource === 'exercises') {
    const inc = includedIds(ctx);
    const ids = inc.length ? inc : ((ctx.planned && ctx.planned.exercises) || []);
    const set = new Set();
    ids.forEach((id) => {
      const e = cat.exById[id];
      if (e) Object.keys(e.load).forEach((r) => { if (e.load[r] >= 2) set.add(r); });
    });
    set.add('knee');
    set.delete('systemic');
    return [...set].slice(0, 5);
  }
  return sportUi(ctx.sportId).painRegions || ['knee', 'shoulder'];
}

function loadedRegions(ctx, cat) {
  if (ctx.loadSource === 'exercises') {
    const set = new Set();
    includedIds(ctx).forEach((id) => {
      const e = cat.exById[id];
      if (e) Object.keys(e.load).forEach((r) => { if (e.load[r] >= 2) set.add(r); });
    });
    return [...set].filter((r) => r !== 'systemic');
  }
  const lp = cat.sports[ctx.sportId].loadProfile;
  return Object.keys(lp).filter((r) => lp[r] >= 2 && r !== 'systemic' && r !== 'knee');
}

// The track is a real control (story #35): tap or drag sets the value via
// onScrub(fraction) — it no longer looks like a slider without being one.
function Stepper({ label, value, display, onStep, onScrub, fillPct, fillColor, right }) {
  const scrub = (e) => {
    if (!onScrub) return;
    const r = e.currentTarget.getBoundingClientRect();
    onScrub(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  return html`<div class="metric">
    <div class="m-label"><span class="ml-t">${label}</span>${right ?? html`<span class="ml-v">${display}</span>`}</div>
    <div class="stepper">
      <button class="sbtn" onClick=${() => onStep(-1)}>−</button>
      <div class="track" style="touch-action:none;cursor:pointer"
        onPointerDown=${(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
        onPointerMove=${(e) => { if (e.buttons) scrub(e); }}>
        <div class="fill" style="width:${fillPct}%;${fillColor ? 'background:' + fillColor : ''}"></div>
      </div>
      <button class="sbtn" onClick=${() => onStep(1)}>+</button>
    </div>
  </div>`;
}

function Segmented({ value, onSelect }) {
  return html`<div class="segmented">
    ${['fresh', 'caution', 'stop'].map((v) => html`
      <div class="seg ${value === v ? 'sel v-' + v : ''}" onClick=${() => onSelect(v)}>
        <span class="seg-mark m-${v}"></span><span class="seg-lbl">${FAT_LABELS[v]}</span>
      </div>`)}
  </div>`;
}

export function LogFlow({ state, now, plannedId, onClose, onFinish, onSkip, toast }) {
  const a11yRef = useOverlayA11y(onClose);
  const cat = catalogOf(state);
  const initial = useMemo(() => {
    const p = state.planned.find((x) => x.id === plannedId) || null;
    const sportId = p ? p.sportId : 'bouldering';
    const sport = cat.sports[sportId];
    return {
      planned: p, sportId, loadSource: sport.loadSource,
      duration: defaultDur(sportId), sRPE: 6, hardFingerLoad: false,
      hm: sportId === 'mountain_day' ? 800 : 0,
      fatigue: {}, pain: null,
      // Story #39: default is "done as planned" — every planned exercise starts
      // checked, the user unchecks what was skipped.
      // Story #50: one entry per exercise with REAL sets (weight × reps),
      // prefilled from history/R9 advice; included=true is the happy path.
      sets: sport.loadSource === 'exercises'
        ? Object.fromEntries((p?.exercises ?? []).map((id) => {
          const pre = prefillSets(id, state, state.profile.goal);
          return [id, { included: true, open: false, rir: pre.rir, source: pre.source, deltaKg: pre.deltaKg, sets: pre.sets, touched: pre.sets.map(() => false) }];
        }))
        : {},
      pickSport: false, editConfirm: false,
      steps: buildSteps(sportId, sport.loadSource),
    };
  }, [plannedId]);

  const [ctx, setCtx] = useState(initial);
  const [step, setStep] = useState(1);
  const [secs, setSecs] = useState(0);
  const [start] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [start]);

  const patch = (obj) => setCtx((c) => ({ ...c, ...obj }));
  const ui = sportUi(ctx.sportId);
  const total = ctx.steps.length;
  const stepName = ctx.steps[step - 1];
  const sc = GOAL_SCHEMES[state.profile.goal];

  const pickSport = (sportId) => {
    const sport = cat.sports[sportId];
    setCtx((c) => ({
      ...c, pickSport: false, planned: null, sportId, loadSource: sport.loadSource,
      duration: defaultDur(sportId), hm: sportId === 'mountain_day' ? 800 : 0,
      hardFingerLoad: false, sets: {}, fatigue: {}, steps: buildSteps(sportId, sport.loadSource),
    }));
    setStep(2);
  };

  const next = () => {
    if (ctx.pickSport) return;
    if (step < total) setStep(step + 1);
    else onFinish(ctx, Math.floor((Date.now() - start) / 1000));
  };
  const prev = () => {
    if (ctx.pickSport) { patch({ pickSport: false }); return; }
    if (step > 1) setStep(step - 1);
  };

  // Ensure fatigue defaults exist for the fatigue step (prototype defaults
  // fingers/quads to müde as a nudge to be honest).
  useEffect(() => {
    if (stepName !== 'fatigue') return;
    setCtx((c) => {
      const fat = { ...c.fatigue };
      loadedRegions(c, cat).forEach((r) => { fat[r] ??= (r === 'fingers' || r === 'quads') ? 'caution' : 'fresh'; });
      return { ...c, fatigue: fat };
    });
  }, [stepName]);

  let body = '';
  const kicker = html`<div class="s-k">Schritt ${step} / ${total}</div>`;

  if (stepName === 'confirm') {
    if (ctx.pickSport) {
      body = html`${kicker}<h2>Was hast du gemacht?</h2><p class="s-hint">Freie Session – unabhängig vom Plan.</p>
        <div class="opt-row">${Object.values(cat.sports).filter((s) => s.id !== 'strength').map((s) => html`
          <button class="opt" onClick=${() => pickSport(s.id)}><${SportGlyph} id=${s.id} /> ${s.name}</button>`)}</div>`;
    } else if (!ctx.planned) {
      body = html`${kicker}<h2>Keine geplante Einheit</h2>
        <div class="alt-row"><button class="alt-choice" onClick=${() => patch({ pickSport: true })}>Freie Session loggen</button></div>`;
    } else {
      const p = ctx.planned;
      // Story #39: default path is one tap on Weiter; the alternatives sit
      // behind the ✎ edit affordance instead of competing with the happy path.
      body = html`${kicker}<h2>Einheit bestätigen</h2><p class="s-hint">Passt? Dann einfach <b>Weiter</b>.</p>
        <div class="session-card"><span class="sc-icon"><${SportGlyph} id=${ctx.sportId} size=${24} /></span>
          <div style="flex:1"><div class="sc-t">${cat.sports[ctx.sportId].name}${p.unit ? ' · ' + p.unit : ''}</div>
          <div class="sc-s">${wdShort(p.date).toUpperCase()} · ${new Date(p.date).getHours()}:00${p.fixed ? ' · 📌 FIX' : ''}</div></div>
          <button class="exr-btn" onClick=${() => patch({ editConfirm: !ctx.editConfirm })} title="Stimmt nicht ganz?" aria-label="Einheit ändern">✎</button></div>
        ${ctx.editConfirm ? html`<div class="alt-row">
          <button class="alt-choice" onClick=${() => patch({ pickSport: true })}>Was anderes gemacht</button>
          <button class="alt-choice" onClick=${() => onSkip(ctx.planned)}>Nicht gemacht – ausgefallen</button>
        </div>` : ''}`;
    }
  } else if (stepName === 'effort') {
    const md = ui.maxDur || 180;
    const m = rpeMeta(ctx.sRPE);
    body = html`${kicker}<h2>Wie war's?</h2><p class="s-hint">Dauer${ctx.sportId === 'mountain_day' ? ' (reine Gehzeit)' : ''} und gefühlte Anstrengung.</p>
      <${Stepper} label="Dauer" display=${fmtDur(ctx.duration)} fillPct=${ctx.duration / md * 100}
        onStep=${(dir) => patch({ duration: Math.max(15, Math.min(md, ctx.duration + dir * (ui.durStep || 15))) })}
        onScrub=${(f) => { const st = ui.durStep || 15; patch({ duration: Math.max(15, Math.min(md, Math.round((f * md) / st) * st)) }); }} />
      ${ctx.sportId === 'mountain_day' ? html`
        <${Stepper} label="Höhenmeter (Abstieg zählt für R4)" display=${ctx.hm + ' hm'} fillPct=${ctx.hm / 3000 * 100}
          onStep=${(dir) => patch({ hm: Math.max(0, Math.min(3000, ctx.hm + dir * 100)) })}
          onScrub=${(f) => patch({ hm: Math.max(0, Math.min(3000, Math.round((f * 3000) / 100) * 100)) })} />` : ''}
      <${Stepper} label="sRPE · Anstrengung" fillPct=${ctx.sRPE * 10} fillColor=${m.c}
        right=${html`<span style="display:flex;align-items:baseline;gap:9px"><span class="rpe-word">${m.w}</span><span class="ml-v" style="color:${m.c}">${ctx.sRPE}/10</span></span>`}
        onStep=${(dir) => patch({ sRPE: Math.max(1, Math.min(10, ctx.sRPE + dir)) })}
        onScrub=${(f) => patch({ sRPE: Math.max(1, Math.min(10, Math.round(f * 10))) })} />`;
  } else if (stepName === 'finger') {
    body = html`${kicker}<h2>Finger heute</h2><p class="s-hint">Nur ein Tap – wichtig für die Sehnen-Erholung (R3).</p>
      <div class="toggle-row"><div class="tr-body"><div class="tr-t">Harte Fingerbelastung</div><div class="tr-s">Leisten, Campus, Projekte am Limit</div></div>
      <div class="switch ${ctx.hardFingerLoad ? 'on' : ''}" onClick=${() => patch({ hardFingerLoad: !ctx.hardFingerLoad })} role="switch" aria-checked=${ctx.hardFingerLoad} tabindex="0"><span class="knob"></span></div></div>`;
  } else if (stepName === 'sets') {
    const exs = ((ctx.planned && ctx.planned.exercises) || []).map((id) => cat.exById[id]).filter(Boolean);
    const included = exs.filter((e) => ctx.sets[e.id]?.included).length;
    const fmtW = (w) => (Math.round(w * 100) / 100).toString().replace('.', ',');
    // Story #50: real sets per exercise — collapsed summary, cascade prefill,
    // one-tap RIR; unchecking an exercise strikes it from the log.
    const patchEx = (id, fn) => {
      const sets = { ...ctx.sets };
      const c = { ...sets[id], sets: sets[id].sets.map((s) => ({ ...s })), touched: [...sets[id].touched] };
      fn(c);
      sets[id] = c;
      patch({ sets });
    };
    const cascade = (c, i, apply) => {
      apply(c.sets[i]);
      c.touched[i] = true;
      for (let j = i + 1; j < c.sets.length; j++) if (!c.touched[j]) apply(c.sets[j]);
    };
    body = html`${kicker}<h2>Übungen</h2><p class="s-hint">Sätze vorbefüllt (${included}/${exs.length} dabei) – <b>nur Abweichungen anfassen</b>. RIR = Wiederholungen in Reserve im letzten Satz.</p>
      ${exs.map((e) => {
        const r = exerciseReadiness(e.id, now, state, now);
        const c = ctx.sets[e.id];
        if (!c) return '';
        const step = incrementFor(e).step || 2.5;
        const on = c.included;
        const sum = `${c.sets.length} Sätze · ${fmtW(c.sets[0].w)} kg · ${c.sets.map((s) => s.reps).join('/')}`;
        return html`<div class="exr" style=${on ? '' : 'opacity:.55'}>
          <div class="exr-head" style="display:flex;align-items:baseline;gap:8px">
            <span class="mark m-${r.level}" style="flex:none" title=${r.reasons[0] || 'frei'}></span>
            <span class="exr-n" style="font-weight:700;${on ? '' : 'text-decoration:line-through'}">${e.name}</span>
            ${c.source === 'advice' ? html`<span class="hint-chip ok" style="margin:0">↑ +${fmtW(c.deltaKg)} kg (Coach)</span>` : ''}
            ${c.source === 'fresh' ? html`<span class="hint-chip warn" style="margin:0">erstes Mal – Last einstellen</span>` : ''}
            <button class="exr-btn" style="margin-left:auto" aria-label=${on ? 'Übung weglassen' : 'Übung wieder aufnehmen'}
              onClick=${() => patchEx(e.id, (cc) => { cc.included = !cc.included; })}>${on ? '✓' : '○'}</button>
          </div>
          ${r.level !== 'fresh' ? html`<div class="exr-r">${r.reasons.join(' · ')}</div>` : ''}
          ${on ? html`
          <div class="setline" style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <button class="sum-btn ${c.open ? 'open' : ''}" onClick=${() => patchEx(e.id, (cc) => { cc.open = !cc.open; })} aria-expanded=${c.open}>
              <span>${sum}</span><span class="acc-caret" aria-hidden="true">›</span></button>
            <div class="rir"><span>RIR</span>${[0, 1, 2, 3].map((n) => html`
              <button class=${c.rir === n ? 'sel' : ''} onClick=${() => patchEx(e.id, (cc) => { cc.rir = n; })}>${n === 3 ? '3+' : n}</button>`)}</div>
          </div>
          ${c.open ? html`
            ${c.sets.map((s, i) => html`
              <div class="setrow">
                <span class="s-lbl">S${i + 1}</span>
                <div class="stp sm"><button onClick=${() => patchEx(e.id, (cc) => cascade(cc, i, (x) => { x.w = Math.max(0, x.w - step); }))}>−</button>
                  <span class="v">${fmtW(s.w)}<small> kg</small></span>
                  <button onClick=${() => patchEx(e.id, (cc) => cascade(cc, i, (x) => { x.w = x.w + step; }))}>+</button></div>
                <div class="stp sm"><button onClick=${() => patchEx(e.id, (cc) => cascade(cc, i, (x) => { x.reps = Math.max(1, x.reps - 1); }))}>−</button>
                  <span class="v">${s.reps}<small> Wdh</small></span>
                  <button onClick=${() => patchEx(e.id, (cc) => cascade(cc, i, (x) => { x.reps = Math.min(20, x.reps + 1); }))}>+</button></div>
                ${c.sets.length > 1 ? html`<button class="s-del" aria-label="Satz entfernen" onClick=${() => patchEx(e.id, (cc) => { cc.sets.splice(i, 1); cc.touched.splice(i, 1); })}>✕</button>` : ''}
              </div>`)}
            <button class="addset" onClick=${() => patchEx(e.id, (cc) => { cc.sets.push({ ...cc.sets[cc.sets.length - 1] }); cc.touched.push(true); })}>＋ Satz</button>
          ` : ''}` : ''}
        </div>`;
      })}`;
  } else if (stepName === 'fatigue') {
    const regs = loadedRegions(ctx, cat);
    body = html`${kicker}<h2>Ermüdung</h2><p class="s-hint">Nur die belasteten Regionen. <b>müde</b> → nächste Einheit lockerer · <b>platt</b> → Region erst mal raus.</p>
      ${regs.map((r) => html`<div class="region-block"><div class="rb-name">${REGION_LABELS[r]}</div>
        <${Segmented} value=${ctx.fatigue[r] || 'fresh'} onSelect=${(v) => patch({ fatigue: { ...ctx.fatigue, [r]: v } })} />
      </div>`)}`;
  } else if (stepName === 'pain') {
    const pain = ctx.pain;
    body = html`${kicker}<h2>Schmerz?</h2><p class="s-hint">Optional. Nur wenn wirklich was zwickt – das behandelt HybridAthlete strenger als Ermüdung (R1).</p>
      ${!pain ? html`<button class="pain-launch" onClick=${() => patch({ pain: { region: null, nrs: null } })}><span>＋</span> Schmerz melden</button>` : html`
        <div class="pain-panel show">
          <div class="region-block"><div class="rb-name">Region</div><div class="segmented">
            ${painRegionsFor(ctx, cat).map((r) => html`<div class="seg ${pain.region === r ? 'sel v-stop' : ''}" onClick=${() => patch({ pain: { ...pain, region: r } })}><span class="seg-lbl">${REGION_LABELS[r]}</span></div>`)}
          </div></div>
          <div class="region-block" style="margin-top:14px"><div class="rb-name">Intensität <span class="rb-hint">NRS 0–10</span></div>
            <div class="nrs-scale">${[...Array(11)].map((_, i) => html`<button class="nrs ${pain.nrs === i ? 'sel' : ''}" onClick=${() => patch({ pain: { ...pain, nrs: i } })}>${i}</button>`)}</div>
            <div class="nrs-legend"><span>0 · kein</span><span>5</span><span>10 · stark</span></div></div>
        </div>`}`;
  }

  return html`<div class="overlay show" role="dialog" aria-modal="true" tabindex="-1" ref=${a11yRef} aria-hidden="false">
    <div class="ov-head">
      <button class="oh-close" onClick=${onClose} aria-label="Abbrechen">✕</button>
      <span class="oh-timer">⏱ <b style="color:${secs <= 60 ? 'var(--fresh)' : 'var(--caution)'}">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b></span>
    </div>
    <div class="progress"><div class="bar" style="width:${step / total * 100}%"></div></div>
    <div class="ov-body">${body}</div>
    <div class="ov-foot" style="display:flex;gap:10px">
      <button class="back-btn" onClick=${prev} style="visibility:${(step > 1 || ctx.pickSport) ? 'visible' : 'hidden'}" aria-label="Zurück">‹</button>
      <button class="next-btn ${step === total ? 'done' : ''}" onClick=${next} style="flex:1;visibility:${ctx.pickSport ? 'hidden' : 'visible'}">${step === total ? 'Fertig – speichern' : 'Weiter'}</button>
    </div>
  </div>`;
}
