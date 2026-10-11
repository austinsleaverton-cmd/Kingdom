// DOM overlay: stats, mode bar, selection panel, tooltip and game-over screen.
// Reads from the world, never writes to it: clicks go back through handlers.
import type { GameState } from '../world/game';
import { WIN_SHARE } from '../world/game';

export type BarMode = 'select' | 'claim' | 'city';

export interface HudHandlers {
  onMode(mode: BarMode): void;
  onEndTurn(): void;
  onMenu(): void;
}

export interface PanelButton {
  label: string;
  key?: string;
  enabled: boolean;
  hint: string; // cost or reason it's disabled
  active?: boolean;
  onClick: () => void;
}

export interface PanelModel {
  title: string;
  lines: string[];
  buttons: PanelButton[];
}

const MODES: { id: BarMode; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: '1' },
  { id: 'claim', label: 'Claim land', key: '2' },
  { id: 'city', label: 'Found city', key: '3' },
];

const CSS = `
.k-hud { position: fixed; inset: 0; pointer-events: none; font: 14px/1.35 system-ui, sans-serif; color: #eee; }
.k-panel { position: absolute; background: rgba(15,15,20,0.9); border: 1px solid #333; border-radius: 8px; padding: 10px 12px; pointer-events: auto; }
.k-stats { top: 12px; left: 12px; min-width: 230px; }
.k-stats b { color: #fff; }
.k-row { display: flex; justify-content: space-between; gap: 12px; }
.k-res { font-size: 12px; color: #ccc; }
.k-dead { opacity: 0.4; text-decoration: line-through; }
.k-log { margin-top: 8px; font-size: 12px; color: #aaa; }
.k-bar { bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; }
.k-hud button { background: #262630; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 7px 12px; font: inherit; cursor: pointer; }
.k-hud button:hover:not(:disabled) { background: #33333f; }
.k-hud button.k-on { background: #2563eb; border-color: #60a5fa; }
.k-hud button:disabled { opacity: 0.45; cursor: default; }
.k-bar button.k-end { background: #15803d; border-color: #22c55e; margin-left: 8px; }
.k-hud kbd { opacity: 0.6; font-size: 11px; margin-right: 4px; }
.k-help { top: 12px; right: 12px; max-width: 260px; font-size: 12px; color: #bbb; }
.k-sel { bottom: 70px; left: 12px; width: 250px; display: none; }
.k-sel h4 { margin: 0 0 4px; }
.k-sel .k-lines { font-size: 12px; color: #bbb; margin-bottom: 8px; }
.k-sel button { display: flex; justify-content: space-between; width: 100%; margin-top: 4px; padding: 6px 10px; font-size: 13px; }
.k-sel button small { opacity: 0.7; margin-left: 8px; }
.k-tip { position: fixed; pointer-events: none; background: rgba(0,0,0,0.85); border: 1px solid #555; border-radius: 6px; padding: 6px 8px; font-size: 12px; white-space: pre; display: none; }
.k-tip .k-bad { color: #f87171; } .k-tip .k-good { color: #4ade80; }
.k-over { inset: 0; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); pointer-events: auto; position: absolute; }
.k-over .k-panel { position: static; text-align: center; padding: 24px 32px; font-size: 16px; }
.k-over h1 { margin: 0 0 8px; }
.k-over button { margin-top: 16px; background: #2563eb; color: #fff; border: 0; padding: 8px 18px; }
`;

export class Hud {
  private root: HTMLDivElement;
  private stats: HTMLDivElement;
  private tip: HTMLDivElement;
  private over: HTMLDivElement;
  private overText: HTMLDivElement;
  private help: HTMLDivElement;
  private sel: HTMLDivElement;
  private modeBtns = new Map<BarMode, HTMLButtonElement>();

  constructor(handlers: HudHandlers) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('k-hud');
    document.body.appendChild(this.root);

    this.stats = el('k-panel k-stats');
    this.root.appendChild(this.stats);

    this.help = el('k-panel k-help');
    this.root.appendChild(this.help);

    this.sel = el('k-panel k-sel');
    this.root.appendChild(this.sel);

    const bar = el('k-panel k-bar');
    for (const m of MODES) {
      const b = button(`<kbd>${m.key}</kbd>${m.label}`, () => handlers.onMode(m.id));
      this.modeBtns.set(m.id, b);
      bar.appendChild(b);
    }
    const end = button('<kbd>Space</kbd>End turn', () => handlers.onEndTurn());
    end.className = 'k-end';
    bar.appendChild(end);
    bar.appendChild(button('<kbd>Esc</kbd>Menu', () => handlers.onMenu()));
    this.root.appendChild(bar);

    this.tip = el('k-tip');
    this.root.appendChild(this.tip);

    this.over = el('k-over');
    const box = el('k-panel');
    this.overText = el('');
    box.appendChild(this.overText);
    box.appendChild(button('Back to menu', () => handlers.onMenu()));
    this.over.appendChild(box);
    this.root.appendChild(this.over);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  update(state: GameState, mode: string): void {
    const land = state.landCount();
    const rows = state.players.map((p) => {
      const tiles = state.ownedTiles(p.id).length;
      const color = `#${p.color.toString(16).padStart(6, '0')}`;
      const free = p.id === 0 && state.options.freeBuild;
      const gold = free ? 'free' : `${p.gold}g (+${state.income(p.id)})`;
      const res =
        p.id === 0
          ? `<div class="k-row k-res"><span>Food ${state.foodUsed(0)}/${state.foodMade(0)} used</span>` +
            `<span>Stone ${p.stone} (+${state.stoneIncome(0)})</span></div>`
          : '';
      return (
        `<div class="${p.alive ? '' : 'k-dead'}" style="margin-top:6px">` +
        `<div class="k-row"><b style="color:${color}">${p.name}</b><span>${p.alive ? gold : 'fallen'}</span></div>` +
        res +
        `<div class="k-row k-res"><span>${tiles} tiles (${Math.round((tiles / land) * 100)}%)</span>` +
        `<span>${state.cityCount(p.id)} cities · ${state.unitsOf(p.id).length} units</span></div></div>`
      );
    });
    const modeLabel = state.sandbox ? 'Sandbox' : `${state.players.length - 1} rival${state.players.length > 2 ? 's' : ''}`;
    this.stats.innerHTML =
      `<div class="k-row"><b>Turn ${state.turn}</b><span>${modeLabel} · seed ${state.seed}</span></div><hr style="border-color:#333">` +
      rows.join('') +
      `<div class="k-log">${state.log.map(escape).join('<br>')}</div>`;

    const goal = state.sandbox
      ? '<b>Sandbox:</b> no rivals, no deadline. Grow and shape your kingdom however you want.'
      : `<b>Goal:</b> take every rival capital or hold ${Math.round(WIN_SHARE * 100)}% of the land. Lose your capital and it's over.`;
    this.help.innerHTML =
      `${goal}<br><br>` +
      `Click your city to recruit a <b>Builder</b>. Select a builder, click a lit hex to move, then pick a job: ` +
      `farms (food), mines (stone), roads (faster moves), or raise/lower the land.<br><br>` +
      `Claim land up to 4 hexes from a city (green in Claim mode); each tile costs a bit more than the last, so found new cities to expand.<br><br>` +
      `Food limits how many units you can keep. Right-click cancels. Drag to pan, scroll to zoom. Progress autosaves.`;

    for (const [id, b] of this.modeBtns) b.classList.toggle('k-on', id === mode);

    if (state.winner !== null) {
      const won = state.winner === 0;
      this.overText.innerHTML = `<h1>${won ? 'Victory' : 'Defeat'}</h1>${escape(state.winReason)}`;
      this.over.style.display = 'flex';
    } else {
      this.over.style.display = 'none';
    }
  }

  showPanel(model: PanelModel | null): void {
    if (!model) {
      this.sel.style.display = 'none';
      return;
    }
    this.sel.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = model.title;
    this.sel.appendChild(h);
    const lines = el('k-lines');
    lines.innerHTML = model.lines.map(escape).join('<br>');
    this.sel.appendChild(lines);
    for (const b of model.buttons) {
      const btn = button(
        `<span>${b.key ? `<kbd>${b.key}</kbd>` : ''}${escape(b.label)}</span><small>${escape(b.hint)}</small>`,
        b.onClick,
      );
      btn.disabled = !b.enabled;
      btn.title = b.hint;
      if (b.active) btn.classList.add('k-on');
      this.sel.appendChild(btn);
    }
    this.sel.style.display = 'block';
  }

  showTip(lines: string[], status: string, ok: boolean, x: number, y: number): void {
    this.tip.innerHTML =
      lines.map(escape).join('\n') + (status ? `\n<span class="${ok ? 'k-good' : 'k-bad'}">${escape(status)}</span>` : '');
    this.tip.style.display = 'block';
    this.tip.style.left = `${x + 16}px`;
    this.tip.style.top = `${y + 16}px`;
  }

  hideTip(): void {
    this.tip.style.display = 'none';
  }
}

function el(className: string): HTMLDivElement {
  const e = document.createElement('div');
  if (className) e.className = className;
  return e;
}

function button(html: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.innerHTML = html;
  b.onclick = () => {
    b.blur();
    onClick();
  };
  return b;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
