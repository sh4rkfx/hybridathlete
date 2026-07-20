// Session editor + add flow (spec §6.5): day/slot/fix, strength exercise list
// with per-exercise readiness for the CHOSEN day (live on day change),
// readiness-aware prefill for new strength sessions.
import { html } from './html.js';
import { useOverlayA11y } from './overlayA11y.js';
import { useState, useMemo } from 'preact/hooks';
import { atHour, addDays, dOnly, WD, wdShort } from '../engine/time.js';
import { REGION_LABELS, FAT_LABELS } from '../engine/texts.js';
import { catalogOf, SPLITS, UNIT_CATS } from '../engine/catalog.js';
import { exerciseReadiness, READY_RANK } from '../engine/readiness.js';
import { generateStrength } from '../engine/generator.js';
import { passesConstraints } from '../engine/swap.js';
import { sportUi, SportGlyph } from './sportsUi.js';
import { SLOT_HOUR, SLOT_LABEL, exerciseListSummary } from './helpers.js';

function prefillStrength(state, unit, when) {
  const gen = generateStrength(state.profile, state, when).find((u) => u.unit === unit);
  return gen ? gen.exercises.slice() : [];
}

export function SessionEditor({ state, now, mode, sessionId, initDay = 1, initSlot = 'evening', onClose, onSave, toast }) {
  const a11yRef = useOverlayA11y(onClose);
  const cat = catalogOf(state);
  const isAdd = mode === 'add';
  const p = isAdd ? null : state.planned.find((x) => x.id === sessionId);

  const [ctx, setCtx] = useState(() => {
    if (isAdd) {
      const split = SPLITS[state.profile.split] || SPLITS.PPL;
      const avail = split.units.filter((u) => !(state.profile.disabledUnits || []).includes(u));
      const unit = avail[0] || split.units[0];
      const dayOff = Math.max(0, Math.min(6, initDay));
      const when = atHour(addDays(dOnly(now), dayOff), SLOT_HOUR[initSlot]);
      return { dayOff, slot: initSlot, fixed: false, sportId: 'strength', unit, exercises: prefillStrength(state, unit, when) };
    }
    const dayOff = Math.max(0, Math.min(6, Math.round((dOnly(p.date) - dOnly(now)) / 864e5)));
    return { dayOff, slot: p.slot, fixed: !!p.fixed, sportId: p.sportId, unit: p.unit ?? null, exercises: p.exercises ? p.exercises.slice() : null };
  });

  const when = atHour(addDays(dOnly(now), ctx.dayOff), SLOT_HOUR[ctx.slot]);
  const patch = (obj) => setCtx((c) => ({ ...c, ...obj }));
  const reseed = (next) => {
    const merged = { ...ctx, ...next };
    if (isAdd && merged.sportId === 'strength') {
      const w = atHour(addDays(dOnly(now), merged.dayOff), SLOT_HOUR[merged.slot]);
      merged.exercises = prefillStrength(state, merged.unit, w);
    }
    setCtx(merged);
  };

  const addable = useMemo(() => {
    if (ctx.sportId !== 'strength' || !ctx.exercises) return [];
    const cats = UNIT_CATS[ctx.unit] || [ctx.unit];
    return cat.exercises
      .filter((e) => cats.includes(e.cat) && !ctx.exercises.includes(e.id) && passesConstraints(e, state.profile))
      .map((e) => {
        const r = exerciseReadiness(e.id, when, state, now);
        return { id: e.id, name: e.name, lv: r.level, mark: r.level === 'fresh' ? '●' : r.level === 'caution' ? '◆' : '■' };
      })
      .sort((a, b) => READY_RANK[a.lv] - READY_RANK[b.lv]);
  }, [ctx, when]);
  const [addSel, setAddSel] = useState('');

  const swapEx = (i) => {
    const orig = cat.exById[ctx.exercises[i]];
    const cats = UNIT_CATS[ctx.unit] || [ctx.unit];
    const ok = (e) => !ctx.exercises.includes(e.id) && passesConstraints(e, state.profile) && exerciseReadiness(e.id, when, state, now).level === 'fresh';
    const cand = cat.exercises.find((e) => e.cat === orig.cat && ok(e)) || cat.exercises.find((e) => cats.includes(e.cat) && ok(e));
    if (!cand) { toast('Keine freie Alternative gefunden', 'stop'); return; }
    const ex = ctx.exercises.slice();
    ex[i] = cand.id;
    patch({ exercises: ex });
    toast(orig.name + ' → ' + cand.name);
  };

  const sport = cat.sports[ctx.sportId];
  const split = SPLITS[state.profile.split] || SPLITS.PPL;
  const availUnits = split.units.filter((u) => !(state.profile.disabledUnits || []).includes(u));

  const exSection = (ctx.sportId === 'strength' && ctx.exercises) ? (() => {
    const rs = ctx.exercises.map((id) => ({ id, r: exerciseReadiness(id, when, state, now) }));
    const dayLbl = ctx.dayOff === 0 ? 'heute' : WD[when.getDay()] + ' ' + when.getDate() + '.';
    // Story #43: this is THIS session's plan, checked for the chosen day —
    // the summary line names the check instead of a cryptic count.
    const sum = exerciseListSummary(rs.map((x) => x.r.level), dayLbl);
    return html`<div class="field">
      <div class="f-lbl">Übungen dieser Einheit</div>
      <p class="subtle" style="font-size:12.5px;margin:2px 0 10px;color:var(--${sum.tone === 'fresh' ? 'fresh' : sum.tone === 'stop' ? 'stop' : 'caution'})">${sum.text}</p>
      ${rs.map((x, i) => {
        const e = cat.exById[x.id];
        const lv = x.r.level;
        return html`<div class="exr">
          <span class="mark m-${lv}" title=${FAT_LABELS[lv] || lv}></span>
          <div class="exr-b"><div class="exr-n ${lv === 'stop' ? 'blocked' : ''}">${e.name}</div>
            <div class="exr-r">${x.r.reasons.length ? x.r.reasons.join(' · ') : 'frei – keine Einschränkung'}</div></div>
          ${lv !== 'fresh' ? html`<button class="exr-btn" onClick=${() => swapEx(i)} title="Alternative suchen">⇄</button>` : ''}
          <button class="exr-btn" onClick=${() => patch({ exercises: ctx.exercises.filter((_, j) => j !== i) })} title="entfernen">✕</button>
        </div>`;
      })}
      <div class="c-add" style="margin-top:8px">
        <select class="csel" style="flex:1" value=${addSel} onChange=${(e) => setAddSel(e.target.value)}>
          <option value="">– Übung wählen –</option>
          ${addable.map((e) => html`<option value=${e.id}>${e.mark} ${e.name}</option>`)}
        </select>
        <button class="opt" onClick=${() => { if (addSel) { patch({ exercises: [...ctx.exercises, addSel] }); setAddSel(''); } }}>＋</button>
      </div>
      <p class="subtle" style="font-size:12px;margin-top:8px">Machbarkeit gilt für den gewählten Tag – wechsle den Tag und schau, wie sich die Ampeln ändern (z. B. wenn das Bergtag-Fenster abläuft).</p>
    </div>`;
  })() : '';

  return html`<div class="overlay show" role="dialog" aria-modal="true" tabindex="-1" ref=${a11yRef} aria-hidden="false">
    <div class="ov-head"><button class="oh-close" onClick=${onClose} aria-label="Abbrechen">✕</button><span class="oh-title">${isAdd ? 'Einheit planen' : 'Einheit bearbeiten'}</span><span style="width:38px"></span></div>
    <div class="ov-body">
      ${isAdd ? html`
        <div class="session-card" style="margin-bottom:20px"><span class="sc-icon"><${SportGlyph} id=${ctx.sportId} size=${24} /></span>
          <div><div class="sc-t">Neue Einheit</div><div class="sc-s">${WD[when.getDay()].toUpperCase()} ${when.getDate()}. · ${SLOT_LABEL[ctx.slot].toUpperCase()}</div></div></div>
        <div class="field"><div class="f-lbl">Sport</div><div class="opt-row">
          ${Object.values(cat.sports).map((sp) => html`<button class="opt ${ctx.sportId === sp.id ? 'sel' : ''}" onClick=${() => reseed({ sportId: sp.id, unit: sp.id === 'strength' ? (availUnits[0] || null) : null, exercises: sp.id === 'strength' ? [] : null })}><${SportGlyph} id=${sp.id} /> ${sp.name}</button>`)}
        </div></div>
        ${ctx.sportId === 'strength' ? html`<div class="field"><div class="f-lbl">Unit (${split.label})</div><div class="opt-row">
          ${availUnits.map((u) => html`<button class="opt ${ctx.unit === u ? 'sel' : ''}" onClick=${() => reseed({ unit: u })}>${u}</button>`)}
        </div></div>` : ''}`
      : html`
        <div class="session-card" style="margin-bottom:20px"><span class="sc-icon"><${SportGlyph} id=${p.sportId} size=${24} /></span>
          <div><div class="sc-t">${cat.sports[p.sportId].name}${p.unit ? ' · ' + p.unit : ''}</div>
          <div class="sc-s">${p.status === 'removed' ? 'GESTRICHEN' : wdShort(p.date).toUpperCase() + ' · ' + new Date(p.date).getHours() + ':00'}</div></div></div>`}
      <div class="field"><div class="f-lbl">Tag</div><div class="opt-row">
        ${[...Array(7)].map((_, i) => {
          const d = addDays(dOnly(now), i);
          return html`<button class="opt ${ctx.dayOff === i ? 'sel' : ''}" onClick=${() => reseed({ dayOff: i })}>${i === 0 ? 'Heute' : WD[d.getDay()] + ' ' + d.getDate() + '.'}</button>`;
        })}
      </div></div>
      <div class="field"><div class="f-lbl">Slot</div><div class="opt-row">
        ${Object.keys(SLOT_HOUR).map((sl) => html`<button class="opt ${ctx.slot === sl ? 'sel' : ''}" onClick=${() => reseed({ slot: sl })}>${SLOT_LABEL[sl]}</button>`)}
      </div></div>
      ${exSection}
      <div class="toggle-row"><div class="tr-body"><div class="tr-t">📌 Fixe Einheit</div><div class="tr-s">Fix = die Engine schlägt höchstens Abschwächen oder Anpassen vor, nie Verschieben oder Streichen.</div></div>
        <div class="switch ${ctx.fixed ? 'on' : ''}" onClick=${() => patch({ fixed: !ctx.fixed })} role="switch" aria-checked=${ctx.fixed} tabindex="0"><span class="knob"></span></div></div>
      ${isAdd ? '' : html`<button class="alt-choice" style="width:100%;margin-top:14px" onClick=${() => onSave({ ...ctx, toggleRemove: true })}>${p.status === 'removed' ? 'Wiederherstellen' : 'Einheit streichen'}</button>`}
    </div>
    <div class="ov-foot"><button class="next-btn" onClick=${() => onSave(ctx)}>${isAdd ? 'Zur Woche hinzufügen' : 'Speichern'}</button></div>
  </div>`;
}
