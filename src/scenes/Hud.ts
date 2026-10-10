// DOM overlay for stats, action buttons, tooltip and game-over screen.
// Reads from the world, never writes to it: clicks go back through handlers.
import type { Action, GameState } from '../world/game';
import { WIN_SHARE } from '../world/game';

export interface HudHandlers {
  onAction(action: Action): void;
  onEndTurn(): void;
  onMenu(): void;
}

const ACTIONS: { id: Action; label: string; key: string }[] = [
  { id: 'claim', label: 'Claim', key: '1' },
  { id: 'raise', label: 'Raise', key: '2' },
  { id: 'lower', label: 'Lower', key: '3' },
  { id: 'city', label: 'City', key: '4' },
];

const CSS = `
.k-hud { position: fixed; inset: 0; pointer-events: none; font: 14px/1.35 system-ui, sans-serif; color: #eee; }
.k-panel { position: absolute; background: rgba(15,15,20,0.88); border: 1px solid #333; border-radius: 8px; padding: 10px 12px; pointer-events: auto; }
.k-stats { top: 12px; left: 12px; min-width: 210px; }
.k-stats b { color: #fff; }
.k-row { display: flex; justify-content: space-between; gap: 12px; }
.k-dead { opacity: 0.4; text-decoration: line-through; }
.k-log { margin-top: 8px; font-size: 12px; color: #aaa; }
.k-bar { bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; }
.k-bar button { background: #262630; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 7px 12px; font: inherit; cursor: pointer; }
.k-bar button:hover { background: #33333f; }
.k-bar button.k-on { background: #2563eb; border-color: #60a5fa; }
.k-bar button.k-end { background: #15803d; border-color: #22c55e; margin-left: 8px; }
.k-bar button.k-menu-btn { margin-left: 8px; }
.k-bar kbd { opacity: 0.6; font-size: 11px; margin-right: 4px; }
.k-help { top: 12px; right: 12px; max-width: 260px; font-size: 12px; color: #bbb; }
.k-tip { position: fixed; pointer-events: none; background: rgba(0,0,0,0.85); border: 1px solid #555; border-radius: 6px; padding: 6px 8px; font-size: 12px; white-space: pre; display: none; }
.k-tip .k-bad { color: #f87171; } .k-tip .k-good { color: #4ade80; }
.k-over { inset: 0; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); pointer-events: auto; position: absolute; }
.k-over .k-panel { position: static; text-align: center; padding: 24px 32px; font-size: 16px; }
.k-over h1 { margin: 0 0 8px; }
.k-over button { margin-top: 16px; background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 8px 18px; font: inherit; cursor: pointer; }
`;

export class Hud {
  private root: HTMLDivElement;
  private stats: HTMLDivElement;
  private tip: HTMLDivElement;
  private over: HTMLDivElement;
  private overText: HTMLDivElement;
  private help: HTMLDivElement;
  private buttons = new Map<Action, HTMLButtonElement>();

  constructor(handlers: HudHandlers) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('div', 'k-hud');
    document.body.appendChild(this.root);

    this.stats = el('div', 'k-panel k-stats');
    this.root.appendChild(this.stats);

    this.help = el('div', 'k-panel k-help');
    this.root.appendChild(this.help);

    const bar = el('div', 'k-panel k-bar');
    for (const a of ACTIONS) {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${a.key}</kbd>${a.label}`;
      b.onclick = () => {
        b.blur();
        handlers.onAction(a.id);
      };
      this.buttons.set(a.id, b);
      bar.appendChild(b);
    }
    const end = document.createElement('button');
    end.className = 'k-end';
    end.innerHTML = '<kbd>Space</kbd>End turn';
    end.onclick = () => {
      end.blur();
      handlers.onEndTurn();
    };
    bar.appendChild(end);
    const menu = document.createElement('button');
    menu.className = 'k-menu-btn';
    menu.innerHTML = '<kbd>Esc</kbd>Menu';
    menu.onclick = () => {
      menu.blur();
      handlers.onMenu();
    };
    bar.appendChild(menu);
    this.root.appendChild(bar);

    this.tip = el('div', 'k-tip');
    this.root.appendChild(this.tip);

    this.over = el('div', 'k-over');
    const box = el('div', 'k-panel');
    this.overText = el('div', '');
    const again = document.createElement('button');
    again.textContent = 'Back to menu';
    again.onclick = () => {
      again.blur();
      handlers.onMenu();
    };
    box.appendChild(this.overText);
    box.appendChild(again);
    this.over.appendChild(box);
    this.root.appendChild(this.over);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  update(state: GameState, selected: Action): void {
    const land = state.landCount();
    const rows = state.players.map((p) => {
      const tiles = state.ownedTiles(p.id).length;
      const color = `#${p.color.toString(16).padStart(6, '0')}`;
      const goldText = p.id === 0 && state.options.freeBuild ? 'free' : `${p.gold}g (+${state.income(p.id)})`;
      return (
        `<div class="${p.alive ? '' : 'k-dead'}" style="margin-top:6px">` +
        `<div class="k-row"><b style="color:${color}">${p.name}</b><span>${p.alive ? goldText : 'fallen'}</span></div>` +
        `<div class="k-row"><span>${tiles} tiles (${Math.round((tiles / land) * 100)}%)</span>` +
        `<span>${state.cityCount(p.id)} cities</span></div></div>`
      );
    });
    const mode = state.sandbox ? 'Sandbox' : `${state.players.length - 1} rival${state.players.length > 2 ? 's' : ''}`;
    this.stats.innerHTML =
      `<div class="k-row"><b>Turn ${state.turn}</b><span>${mode} · seed ${state.seed}</span></div><hr style="border-color:#333">` +
      rows.join('') +
      `<div class="k-log">${state.log.map(escape).join('<br>')}</div>`;

    const goal = state.sandbox
      ? '<b>Sandbox:</b> no rivals, no deadline. Grow and shape your kingdom however you want.'
      : `<b>Goal:</b> take every rival capital or hold ${Math.round(WIN_SHARE * 100)}% of the land. Lose your capital and it's over.`;
    this.help.innerHTML =
      `${goal}<br><br>` +
      `Claim tiles that border your land. Cities give gold and grab nearby tiles. ` +
      `Raise/lower land to make bridges or shape terrain. Hills pay the most.<br><br>` +
      `Drag to pan, scroll to zoom. <kbd>Space</kbd> ends turn, <kbd>Esc</kbd> menu. Progress autosaves.`;

    for (const [id, b] of this.buttons) b.classList.toggle('k-on', id === selected);

    if (state.winner !== null) {
      const won = state.winner === 0;
      this.overText.innerHTML = `<h1>${won ? 'Victory' : 'Defeat'}</h1>${escape(state.winReason)}`;
      this.over.style.display = 'flex';
    } else {
      this.over.style.display = 'none';
    }
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

function el(tag: 'div', className: string): HTMLDivElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
