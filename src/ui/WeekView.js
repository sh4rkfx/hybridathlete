import { html } from './html.js';
import { useRef, useEffect } from 'preact/hooks';
import { addDays, dOnly, isSameDay, WD } from '../engine/time.js';
import { catalogOf } from '../engine/catalog.js';
import { sportUi } from './sportsUi.js';

// Pointer-based drag & drop (no native HTML5 DnD — no touch support there):
// ~280 ms long-press lifts the card (ghost follows the pointer), >10 px of
// movement before the lift means scrolling and cancels, drop on an empty slot
// moves, drop on an occupied slot swaps, logged targets are refused upstream.
function useWeekDnD(rootRef, { onMove, suppressTapRef }) {
  const drag = useRef(null);
  useEffect(() => {
    const sec = rootRef.current;
    if (!sec) return undefined;

    const blockScroll = (e) => { if (drag.current && drag.current.lifted) e.preventDefault(); };
    const cleanup = () => {
      document.removeEventListener('touchmove', blockScroll);
      if (drag.current?.ghost) drag.current.ghost.remove();
      document.querySelectorAll('.drag-src,.drop-hint').forEach((x) => x.classList.remove('drag-src', 'drop-hint'));
      drag.current = null;
    };
    const placeGhost = (x, y) => {
      const g = drag.current.ghost;
      g.style.left = (x - g.offsetWidth / 2) + 'px';
      g.style.top = (y - 26) + 'px';
    };
    const lift = () => {
      const d = drag.current;
      if (!d) return;
      d.lifted = true;
      document.addEventListener('touchmove', blockScroll, { passive: false });
      const g = d.cell.cloneNode(true);
      g.classList.add('drag-ghost');
      g.style.width = d.cell.offsetWidth + 'px';
      document.body.appendChild(g);
      d.ghost = g;
      placeGhost(d.x, d.y);
      d.cell.classList.add('drag-src');
    };
    const target = (x, y) => {
      const d = drag.current;
      if (!d.ghost) return null;
      d.ghost.style.display = 'none';
      const el = document.elementFromPoint(x, y);
      d.ghost.style.display = '';
      const t = el && el.closest('.slot[data-day]');
      return (t && t !== d.cell) ? t : null;
    };
    const down = (e) => {
      const cell = e.target.closest('.slot[data-pid]');
      if (!cell) return;
      drag.current = { pid: cell.dataset.pid, cell, x: e.clientX, y: e.clientY, lifted: false, timer: setTimeout(lift, 280) };
    };
    const move = (e) => {
      const d = drag.current;
      if (!d) return;
      if (!d.lifted) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) { clearTimeout(d.timer); drag.current = null; }
        return;
      }
      e.preventDefault();
      placeGhost(e.clientX, e.clientY);
      document.querySelectorAll('.drop-hint').forEach((x) => x.classList.remove('drop-hint'));
      const t = target(e.clientX, e.clientY);
      if (t) t.classList.add('drop-hint');
    };
    const up = (e) => {
      const d = drag.current;
      if (!d) return;
      clearTimeout(d.timer);
      if (!d.lifted) { drag.current = null; return; } // plain tap -> onClick handles it
      const t = target(e.clientX, e.clientY);
      const pid = d.pid;
      cleanup();
      suppressTapRef.current = true;
      setTimeout(() => { suppressTapRef.current = false; }, 260);
      if (t) onMove(pid, +t.dataset.day, t.dataset.slot, t.dataset.pid || null);
    };
    const cancel = () => { if (drag.current) { clearTimeout(drag.current.timer); cleanup(); } };

    sec.addEventListener('pointerdown', down);
    sec.addEventListener('pointermove', move, { passive: false });
    sec.addEventListener('pointerup', up);
    sec.addEventListener('pointercancel', cancel);
    return () => {
      sec.removeEventListener('pointerdown', down);
      sec.removeEventListener('pointermove', move);
      sec.removeEventListener('pointerup', up);
      sec.removeEventListener('pointercancel', cancel);
      cleanup();
    };
  }, [rootRef, onMove]);
}

function SlotCell({ p, dayOff, sl, cat, onEdit, onAdd }) {
  if (!p) {
    return html`<div class="slot empty-slot" data-day=${dayOff} data-slot=${sl} onClick=${() => onAdd(dayOff, sl)} style="cursor:pointer" title="Einheit planen"><span class="s-meta" style="text-align:center;opacity:.55">＋</span></div>`;
  }
  const s = cat.sports[p.sportId];
  const ui = sportUi(p.sportId);
  const editable = p.status !== 'logged';
  const meta = p.status === 'logged' ? '✓ geloggt'
    : p.status === 'skipped' ? 'ausgefallen'
    : p.status === 'removed' ? 'gestrichen'
    : (new Date(p.date).getHours() + ':00') + (p.reduced ? ' · reduziert' : '') + (p.adjusted ? ' · angepasst' : '');
  return html`<div
    class="slot ${ui.border} ${(p.status === 'removed' || p.status === 'skipped') ? 'removed' : ''}"
    data-day=${dayOff} data-slot=${sl} data-pid=${editable ? p.id : null}
    onClick=${editable ? () => onEdit(p.id) : null} style=${editable ? 'cursor:pointer' : ''}>
    <span class="s-sport">${ui.emoji} ${s.name}${p.fixed ? ' 📌' : ''}</span>
    <span class="s-meta ${p.status === 'skipped' ? 'skipped' : ''}">${p.unit ? p.unit + ' · ' : ''}${meta}</span>
  </div>`;
}

export function WeekView({ state, now, onEdit, onAdd, onMove, suppressTapRef }) {
  const rootRef = useRef(null);
  useWeekDnD(rootRef, { onMove, suppressTapRef });
  const cat = catalogOf(state);

  const rows = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(dOnly(now), i);
    const items = state.planned.filter((p) => isSameDay(p.date, day)).sort((a, b) => new Date(a.date) - new Date(b.date));
    const slots = { morning: null, midday: null, evening: null };
    items.forEach((p) => { slots[p.slot] = p; });
    const isToday = i === 0;
    const dlbl = WD[day.getDay()] + ' ' + day.getDate() + '.' + (day.getMonth() + 1) + '.';
    rows.push(html`<div class="day-row ${isToday ? 'today' : ''}" key=${i}>
      <div class="dr-head"><span class="dr-day">${dlbl}${isToday ? html`<span class="td">HEUTE</span>` : ''}</span></div>
      <div class="slots">${['morning', 'midday', 'evening'].map((sl) => html`<${SlotCell} p=${slots[sl]} dayOff=${i} sl=${sl} cat=${cat} onEdit=${onEdit} onAdd=${onAdd} />`)}</div>
    </div>`);
  }

  return html`<div ref=${rootRef}>
    <div class="eyebrow">Planung</div><h1 class="title">Deine Woche</h1>
    <p class="subtle">📌 Fixe Einheiten bleiben unangetastet. HybridAthlete plant nur darum herum.</p>
    <div class="slot-head"><span></span><span>morgens</span><span>mittags</span><span>abends</span></div>
    <div class="week-grid">${rows}</div>
    <button class="alt-choice" style="width:100%;margin-top:12px" onClick=${() => onAdd(1, 'evening')}>＋ Einheit planen</button>
    <div class="proto-note">Antippen = bearbeiten · Halten & Ziehen = verschieben · leerer Slot = neue Einheit</div>
  </div>`;
}
