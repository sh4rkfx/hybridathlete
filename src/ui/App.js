import { html } from './html.js';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { atHour, addDays, dOnly, WD, slotOfHour } from '../engine/time.js';
import { catalogOf, SPLITS } from '../engine/catalog.js';
import { generateStrength } from '../engine/generator.js';
import { REGION_LABELS } from '../engine/texts.js';
import * as store from './store.js';
import { loadDemoWeek } from './demo.js';
import { SLOT_HOUR, SLOT_LABEL } from './helpers.js';
import { HomeScreen } from './HomeScreen.js';
import { WeekView } from './WeekView.js';
import { SuggestionInbox } from './SuggestionInbox.js';
import { RulebookScreen } from './RulebookScreen.js';
import { SettingsScreen } from './SettingsScreen.js';
import { LogFlow } from './LogFlow.js';
import { MorningCheckin } from './MorningCheckin.js';
import { SessionEditor } from './SessionEditor.js';
import { AcwrExplainer } from './AcwrExplainer.js';

const NAV = [
  ['home', 'Home', html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 12l8-8 8 8M5 10v8h4v-5h4v5h4v-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`],
  ['week', 'Woche', html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="4" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3 8h16M8 2v4M14 2v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`],
  ['inbox', 'Inbox', html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 6a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" stroke="currentColor" stroke-width="1.8"/><path d="M3 8l8 5 8-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`],
  ['rules', 'Regeln', html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M5 3h9l4 4v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 3v5h5M7 12h8M7 15h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`],
  ['settings', 'Setup', html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M11 2v3M11 17v3M2 11h3M17 11h3M4.5 4.5l2 2M15.5 15.5l2 2M17.5 4.5l-2 2M6.5 15.5l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`],
];

export function App() {
  const [, setTick] = useState(0);
  const [screen, setScreen] = useState('home');
  const [overlay, setOverlay] = useState(null); // {kind:'log'|'checkin'|'edit'|'add'|'acwr', ...}
  const [toastMsg, setToastMsg] = useState(null);
  const suppressTapRef = useRef(false);
  const toastTimer = useRef(null);
  const now = store.now();
  const state = store.getState();

  useEffect(() => {
    const unsub = store.subscribe(() => setTick((t) => t + 1));
    // boot() may have resolved before this effect ran — re-read once.
    if (store.getState()) setTick((t) => t + 1);
    return unsub;
  }, []);

  const toast = useCallback((text, kind) => {
    setToastMsg({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  if (!state) return html`<div class="phone"><div class="viewport" style="display:grid;place-items:center;color:var(--text-mid)">Lade …</div></div>`;
  const cat = catalogOf(state);
  const sugCount = state.suggestions.length;
  const sugToast = (n) => (n ? `${n} Vorschlag${n === 1 ? '' : 'e'} – Coach hat die Woche geprüft` : 'keine Konflikte');

  /* ---------- actions ---------- */
  const acceptSug = (key) => { store.acceptSuggestion(key); toast('Übernommen ✓ – Woche aktualisiert'); };
  const rejectSug = (key, reason) => { store.rejectSuggestion(key, reason); toast('Abgelehnt – Grund gespeichert'); };

  const finishLog = (ctx, secs) => {
    store.update((st) => {
      const log = {
        id: store.uid(), sportId: ctx.sportId, date: new Date().toISOString(),
        slot: slotOfHour(new Date().getHours()), duration: ctx.duration, sRPE: ctx.sRPE,
        source: 'manual', sets: [],
      };
      if (ctx.sportId === 'bouldering') log.hardFingerLoad = ctx.hardFingerLoad;
      if (ctx.sportId === 'mountain_day') log.elevationGain = ctx.hm;
      if (ctx.loadSource === 'exercises') log.sets = Object.keys(ctx.sets).map((id) => ({ exerciseId: id }));
      st.logs.push(log);
      if (ctx.planned) {
        const p = st.planned.find((x) => x.id === ctx.planned.id);
        if (p) { p.loggedId = log.id; p.status = 'logged'; }
      }
      Object.entries(ctx.fatigue).forEach(([r, lvl]) => {
        st.fatigue.push({ id: store.uid(), region: r, level: lvl, ts: new Date().toISOString(), context: 'post_session' });
      });
      if (ctx.pain && ctx.pain.region && ctx.pain.nrs != null) {
        st.pain.push({ id: store.uid(), region: ctx.pain.region, nrs: ctx.pain.nrs, ts: new Date().toISOString() });
      }
    });
    setOverlay(null);
    setScreen('inbox');
    const n = store.getState().suggestions.length;
    setTimeout(() => toast(`Log in ${secs} s gespeichert · ` + (n ? `${n} neue Vorschläge` : 'keine neuen Vorschläge')), 350);
  };

  const skipSession = (planned) => {
    store.update((st) => {
      const p = st.planned.find((x) => x.id === planned.id);
      if (p) p.status = 'skipped';
    });
    setOverlay(null);
    setScreen('inbox');
    const n = store.getState().suggestions.length;
    setTimeout(() => toast('Als ausgefallen markiert · ' + (n ? `${n} Vorschläge für den Rest der Woche` : 'Woche neu bewertet')), 350);
  };

  const saveCheckin = (levels) => {
    store.update((st) => {
      Object.entries(levels).forEach(([r, lvl]) => {
        st.fatigue.push({ id: store.uid(), region: r, level: lvl, ts: new Date().toISOString(), context: 'morning_checkin' });
      });
    });
    setOverlay(null);
    setScreen('inbox');
    const n = store.getState().suggestions.length;
    setTimeout(() => toast('Check-in gespeichert · ' + (n ? `${n} Vorschläge` : 'keine neuen Vorschläge')), 350);
  };

  const saveEditor = (ctx) => {
    const when = atHour(addDays(dOnly(now), ctx.dayOff), SLOT_HOUR[ctx.slot]);
    if (overlay.kind === 'add') {
      if (ctx.sportId === 'strength' && !(ctx.exercises || []).length) { toast('Mindestens eine Übung wählen', 'stop'); return; }
      store.update((st) => {
        const extra = ctx.sportId === 'strength' ? { unit: ctx.unit, exercises: ctx.exercises.slice() } : {};
        st.planned.push({ id: store.uid(), sportId: ctx.sportId, date: when.toISOString(), slot: ctx.slot, fixed: ctx.fixed, status: 'planned', reduced: false, ...extra });
      });
      setOverlay(null);
      setScreen('week');
      toast('Einheit geplant · ' + sugToast(store.getState().suggestions.length));
      return;
    }
    store.update((st) => {
      const p = st.planned.find((x) => x.id === overlay.sessionId);
      if (!p) return;
      if (ctx.toggleRemove) {
        p.status = p.status === 'removed' ? 'planned' : 'removed';
        return;
      }
      p.date = when.toISOString();
      p.slot = ctx.slot;
      p.fixed = ctx.fixed;
      if (ctx.exercises && p.exercises && ctx.exercises.join() !== p.exercises.join()) {
        p.exercises = ctx.exercises.slice();
        p.adjusted = true;
      }
    });
    setOverlay(null);
    toast(store.getState().planned.find((x) => x.id === overlay.sessionId)?.status === 'removed'
      ? 'Einheit gestrichen'
      : 'Gespeichert · ' + sugToast(store.getState().suggestions.length));
  };

  const moveSession = (pid, dayOff, slot, otherPid) => {
    const st = store.getState();
    const p = st.planned.find((x) => x.id === pid);
    if (!p) return;
    const newDate = atHour(addDays(dOnly(now), dayOff), SLOT_HOUR[slot]).toISOString();
    let msg;
    if (otherPid && otherPid !== pid) {
      const o = st.planned.find((x) => x.id === otherPid);
      if (!o || o.status === 'logged') { toast('Slot belegt – Ziel nicht verschiebbar', 'stop'); return; }
      store.update((s2) => {
        const pp = s2.planned.find((x) => x.id === pid);
        const oo = s2.planned.find((x) => x.id === otherPid);
        const pd = pp.date, ps = pp.slot;
        pp.date = newDate; pp.slot = slot;
        oo.date = pd; oo.slot = ps;
      });
      msg = `${cat.sports[p.sportId].name} ⇄ ${cat.sports[o.sportId].name} getauscht`;
    } else {
      store.update((s2) => {
        const pp = s2.planned.find((x) => x.id === pid);
        pp.date = newDate; pp.slot = slot;
      });
      msg = `${cat.sports[p.sportId].name} → ${WD[new Date(newDate).getDay()]} ${SLOT_LABEL[slot]}`;
    }
    const n = store.getState().suggestions.length;
    toast(msg + (n ? ` · ${n} Vorschlag${n === 1 ? '' : 'e'}` : ''));
  };

  const settingsActions = {
    setGoal: (k) => store.update((st) => { st.profile.goal = k; }),
    setSplit: (k) => store.update((st) => {
      st.profile.split = k;
      st.profile.disabledUnits = (st.profile.disabledUnits || []).filter((u) => SPLITS[k].units.includes(u));
    }),
    toggleUnit: (u) => store.update((st) => {
      const d = st.profile.disabledUnits || [];
      st.profile.disabledUnits = d.includes(u) ? d.filter((x) => x !== u) : [...d, u];
    }),
    addConstraint: (region, level) => {
      store.update((st) => {
        st.profile.constraints = (st.profile.constraints || []).filter((c) => c.region !== region);
        st.profile.constraints.push({ id: store.uid(), region, level });
      });
      toast(REGION_LABELS[region] + ' · ' + (level === 'red' ? 'rot' : 'gelb') + ' angelegt – Generator angepasst');
    },
    delConstraint: (id) => store.update((st) => {
      st.profile.constraints = (st.profile.constraints || []).filter((c) => c.id !== id);
    }),
    regenerate: () => {
      store.update((st) => {
        st.planned = st.planned.filter((p) => p.sportId !== 'strength');
        const dayOff = [1, 3, 5];
        const split = SPLITS[st.profile.split] || SPLITS.PPL;
        const units = split.units.filter((u) => !(st.profile.disabledUnits || []).includes(u));
        units.forEach((unitName, i) => {
          const day = addDays(dOnly(now), dayOff[i % dayOff.length]);
          const when = atHour(day, i === 2 ? 12 : 17);
          const gen = generateStrength(st.profile, st, when, now).find((u) => u.unit === unitName);
          if (gen) st.planned.push({ id: store.uid(), sportId: 'strength', date: when.toISOString(), slot: i === 2 ? 'midday' : 'evening', fixed: false, status: 'planned', reduced: false, unit: gen.unit, exercises: gen.exercises });
        });
      });
      toast('Plan neu generiert · berücksichtigt aktuelle Ermüdung & Schmerz');
      setScreen('week');
    },
    exportData: () => {
      const blob = new Blob([JSON.stringify(store.getState(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'hybridathlete-export.json'; a.click();
      URL.revokeObjectURL(url);
      toast('Export gestartet');
    },
    loadDemo: () => {
      store.update((st) => loadDemoWeek(st, now));
      toast('Demo-Woche geladen – Engine hat die Woche geprüft');
      setScreen('home');
    },
    resetData: async () => { await store.resetAll(); toast('Zurückgesetzt'); setScreen('home'); },
  };

  const openEdit = (id) => { if (!suppressTapRef.current) setOverlay({ kind: 'edit', sessionId: id }); };
  const openAdd = (dayOff, slot) => { if (!suppressTapRef.current) setOverlay({ kind: 'add', dayOff, slot }); };

  const screenEl = {
    home: () => html`<${HomeScreen} state=${state} now=${now}
      onLog=${(id) => setOverlay({ kind: 'log', plannedId: id })}
      onCheckin=${() => setOverlay({ kind: 'checkin' })}
      onAcwr=${() => setOverlay({ kind: 'acwr' })}
      onGoWeek=${() => setScreen('week')}
      onAdd=${openAdd}
      onRegenerate=${settingsActions.regenerate} />`,
    week: () => html`<${WeekView} state=${state} now=${now} onEdit=${openEdit} onAdd=${openAdd} onMove=${moveSession} suppressTapRef=${suppressTapRef} />`,
    inbox: () => html`<${SuggestionInbox} state=${state} onAccept=${acceptSug} onReject=${rejectSug} />`,
    rules: () => html`<${RulebookScreen} state=${state} />`,
    settings: () => html`<${SettingsScreen} state=${state} now=${now} actions=${settingsActions} toast=${toast} />`,
  }[screen]();

  return html`<div class="phone" role="application" aria-label="HybridAthlete">
    <div class="viewport">
      <section class="screen active">${screenEl}</section>
    </div>
    <nav class="tabbar" role="tablist" aria-label="Navigation">
      ${NAV.map(([id, label, icon]) => html`
        <button class="tab ${screen === id ? 'active' : ''}" role="tab" onClick=${() => setScreen(id)}>
          <span class="ti" aria-hidden="true">${icon}${id === 'inbox' && sugCount > 0 ? html`<span class="badge" style="display:grid">${sugCount}</span>` : ''}</span>${label}
        </button>`)}
    </nav>
    ${overlay?.kind === 'log' ? html`<${LogFlow} state=${state} now=${now} plannedId=${overlay.plannedId} onClose=${() => setOverlay(null)} onFinish=${finishLog} onSkip=${skipSession} toast=${toast} />` : ''}
    ${overlay?.kind === 'checkin' ? html`<${MorningCheckin} state=${state} now=${now} onClose=${() => setOverlay(null)} onSave=${saveCheckin} />` : ''}
    ${(overlay?.kind === 'edit' || overlay?.kind === 'add') ? html`<${SessionEditor} state=${state} now=${now} mode=${overlay.kind} sessionId=${overlay.sessionId} initDay=${overlay.dayOff} initSlot=${overlay.slot} onClose=${() => setOverlay(null)} onSave=${saveEditor} toast=${toast} />` : ''}
    ${overlay?.kind === 'acwr' ? html`<${AcwrExplainer} state=${state} now=${now} onClose=${() => setOverlay(null)} />` : ''}
    <div class="toast ${toastMsg ? 'show' : ''}">
      <span class="t-i" style="background:${toastMsg?.kind === 'stop' ? 'var(--stop-dim)' : 'var(--fresh-dim)'}">${toastMsg?.kind === 'stop' ? '✕' : '✓'}</span>
      <span class="t-t">${toastMsg?.text ?? ''}</span>
    </div>
  </div>`;
}
