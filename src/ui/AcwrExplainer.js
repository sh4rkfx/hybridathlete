// ACWR explainer overlay (spec §6.8): live numbers, zones, projection note,
// source + open criticism.
import { html } from './html.js';
import { useOverlayA11y } from './overlayA11y.js';
import { acwr } from '../engine/acwr.js';

export function AcwrExplainer({ state, now, onClose }) {
  const a11yRef = useOverlayA11y(onClose);
  const a = acwr(state.logs, now);
  return html`<div class="overlay show" role="dialog" aria-modal="true" tabindex="-1" ref=${a11yRef} aria-hidden="false">
    <div class="ov-head"><button class="oh-close" onClick=${onClose} aria-label="Schließen">✕</button><span class="oh-title">Wochenlast · ACWR</span><span style="width:38px"></span></div>
    <div class="ov-body">
      <div class="s-k">Acute : Chronic Workload Ratio</div>
      <h2>Wie heiß läuft deine Woche?</h2>
      <p class="s-hint" style="margin-bottom:16px">Der ACWR vergleicht, was du <b>zuletzt</b> gemacht hast, mit dem, was dein Körper <b>gewohnt</b> ist.</p>
      <div class="acwr-math">
        <div class="am-row"><span class="am-k">Akut</span><span class="am-v">${Math.round(a.acute)}</span><span class="am-d">Trainingslast der letzten 7 Tage (Σ sRPE × Minuten)</span></div>
        <div class="am-row"><span class="am-k">Chronisch</span><span class="am-v">${Math.round(a.chronicWk)}</span><span class="am-d">Ø Wochenlast der letzten 28 Tage – deine „Gewöhnung“</span></div>
        <div class="am-row total"><span class="am-k">ACWR</span><span class="am-v">${a.ratio.toFixed(2)}</span><span class="am-d">= Akut ÷ Chronisch</span></div>
      </div>
      <div class="field" style="margin-top:18px"><div class="f-lbl">Die Zonen</div>
        <div class="zone-row"><span class="mark m-caution"></span><span class="z-range">${'<'} 0.8</span><span class="z-t">Untertrainiert – Fitness bröckelt langsam</span></div>
        <div class="zone-row"><span class="mark m-fresh"></span><span class="z-range">0.8 – 1.3</span><span class="z-t">Sweet Spot – niedrigstes Verletzungsrisiko</span></div>
        <div class="zone-row"><span class="mark m-caution"></span><span class="z-range">1.3 – 1.5</span><span class="z-t">Erhöht – bewusst steuern</span></div>
        <div class="zone-row"><span class="mark m-stop"></span><span class="z-range">${'>'} 1.5</span><span class="z-t">Deutlich erhöhtes Risiko – Rampe zu steil</span></div>
      </div>
      <p class="s-hint" style="margin-top:14px">Auf dem Home-Screen ist der Sweet Spot als <b>grünes Band</b> hinter der Lastkurve eingezeichnet. Der Chip zeigt die <b>aktuelle</b> Ratio (Ist-Stand heute); Regel R7 prüft dagegen die <b>prognostizierte</b> ACWR am Ende der Planungswoche – also inklusive allem, was noch ansteht – und meldet sich erst über 1.5. Deshalb können die beiden Zahlen auseinanderliegen.</p>
      <p class="s-hint" style="margin-top:10px;font-size:12.5px">Typischer Fall nach einer ruhigen Phase (Urlaub, Reha): Die chronische Basis ist niedrig, eine normale Woche wirkt plötzlich wie eine steile Rampe – genau das Szenario, in dem sich die meisten Verletzungen anbahnen.</p>
      <div class="evi" style="margin-top:12px"><span class="rule">R7 · Quelle</span><span class="lvl assumption">Kohorte · umstritten</span></div>
      <p class="s-hint" style="margin-top:6px;font-size:12px">Gabbett (2016), Br J Sports Med. Methodische Kritik (Lolli 2019: mathematical coupling; Impellizzeri 2020: Sensitivität) ist bekannt – deshalb hat R7 in HybridAthlete die niedrigste Priorität und schlägt nur den beweglichsten Baustein zum Streichen vor.</p>
    </div>
    <div class="ov-foot"><button class="next-btn" onClick=${onClose}>Verstanden</button></div>
  </div>`;
}
