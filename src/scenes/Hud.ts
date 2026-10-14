// DOM overlay: stats, mode bar, selection panel, tooltip and game-over screen.
// Reads from the world, never writes to it: clicks go back through handlers.
import type { GameState } from '../world/game';
import { CLAIM_RADIUS, DIFFICULTY } from '../world/game';

export type BarMode = 'select' | 'claim';

export interface IdleHandlers {
  onShow(): void;
  onHoldAll(): void;
  onEndAnyway(): void;
}

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

export interface PanelBar {
  label: string;
  value: number;
  max: number;
  color: string; // css color
}

export interface PanelSection {
  heading?: string;
  summary?: string; // shown next to the heading when the section is folded
  bars?: PanelBar[];
  lines?: string[];
  buttons?: PanelButton[];
  folded?: boolean; // starts folded until the player opens it (their choice is remembered)
  grid?: boolean; // buttons in two columns
}

export interface PanelModel {
  title: string;
  subtitle?: string;
  titleAction?: { label: string; onClick: () => void }; // small button next to the title (e.g. Rename)
  sections: PanelSection[];
  footer?: string;
}

// A popup in the middle of the screen (diplomacy, war news)
export interface DialogButton {
  label: string;
  hint?: string;
  kind?: 'main' | 'danger';
  enabled?: boolean; // default true
  onClick: () => void;
}

export interface DialogModel {
  title: string;
  color?: number; // kingdom color for the border and dot
  lines: string[];
  buttons: DialogButton[];
}

// Claiming land is a city action now (city panel), so the bar only needs Select.
const MODES: { id: BarMode; label: string; key: string }[] = [{ id: 'select', label: 'Select', key: '1' }];

const CSS = `
.k-hud { position: fixed; inset: 0; pointer-events: none; font: 14px/1.35 system-ui, sans-serif; color: #eee; }
.k-panel { position: absolute; background: rgba(15,15,20,0.9); border: 1px solid #333; border-radius: 8px; padding: 10px 12px; pointer-events: auto; }
.k-stats { top: 12px; left: 12px; min-width: 230px; }
.k-stats b { color: #fff; }
.k-row { display: flex; justify-content: space-between; gap: 12px; }
.k-res { font-size: 12px; color: #ccc; }
.k-dead { opacity: 0.4; text-decoration: line-through; }
.k-log { font-size: 12px; color: #aaa; }
.k-bar { bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; }
.k-hud button { background: #262630; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 7px 12px; font: inherit; cursor: pointer; }
.k-hud button:hover:not(:disabled) { background: #33333f; }
.k-hud button.k-on { background: #2563eb; border-color: #60a5fa; }
.k-hud button:disabled { opacity: 0.45; cursor: default; }
.k-bar button.k-end { background: #15803d; border-color: #22c55e; margin-left: 8px; }
.k-hud kbd { opacity: 0.6; font-size: 11px; margin-right: 4px; }
.k-help { top: 12px; right: 12px; max-width: 260px; font-size: 12px; color: #bbb; }
/* Selection panel sits top-right (under the ? button) so it never covers the stats panel */
.k-sel { top: 56px; right: 12px; width: 280px; max-height: calc(100% - 140px); overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-y; box-sizing: border-box; }
.k-sel .k-lines { font-size: 12px; line-height: 1.45; color: #bbb; margin: 2px 0 6px; }
.k-sel .k-sub { font-size: 12px; color: #9ca3af; margin: -2px 0 6px; }
.k-sel .k-sec { border-top: 1px solid #2c2c36; padding-top: 4px; margin-top: 4px; }
.k-sel .k-sec:first-of-type { border-top: 0; margin-top: 0; padding-top: 0; }
/* Section headers: big, easy-to-hit rows. In the city panel only one section is open at a time. */
.k-sel h4.k-fold { display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; font-size: 12px; padding: 7px 6px; margin: 0 -6px; border-radius: 5px; color: #a1a1b0; }
.k-sel h4.k-fold:hover { color: #e5e7eb; background: #1f1f29; }
.k-sel h4.k-fold.k-open { color: #e5e7eb; }
.k-sel h4.k-fold .k-chev { display: inline-block; width: 16px; font-size: 13px; color: #6b7280; }
.k-sel h4.k-fold small { text-transform: none; letter-spacing: 0; font-weight: 400; font-size: 12px; color: #9ca3af; }
.k-sel h4 { margin: 0 0 4px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8b8b99; font-weight: 600; }
.k-meter { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #bbb; margin: 2px 0; }
.k-meter span:first-child { width: 44px; }
.k-meter .k-track { flex: 1; height: 7px; background: #23232b; border-radius: 4px; overflow: hidden; }
.k-meter .k-fill { height: 100%; border-radius: 4px; }
.k-meter span:last-child { width: 52px; text-align: right; }
.k-sel .k-foot { font-size: 11px; color: #777; margin-top: 8px; }
.k-stats h4, .k-help h4 { margin: 8px 0 3px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #8b8b99; }
.k-help ul { margin: 0; padding-left: 16px; }
.k-help li { margin: 2px 0; }
.k-mode { font-weight: 400; font-size: 11px; color: #8b8b99; margin-left: 6px; }
.k-resrow { display: flex; align-items: baseline; gap: 6px; font-size: 12px; margin: 3px 0; }
.k-resrow .k-ic { width: 16px; text-align: center; }
.k-resrow .k-lab { width: 38px; color: #9ca3af; }
.k-resrow b { min-width: 34px; font-size: 14px; color: #fff; }
.k-resrow .k-note { color: #8b8b99; font-size: 11px; }
.k-resrow .k-note.k-warn { color: #f87171; }
.k-foodbar { height: 4px; background: #23232b; border-radius: 3px; margin: -1px 0 5px 60px; overflow: hidden; }
.k-foodbar div { height: 100%; }
.k-tab { width: 100%; border-collapse: collapse; font-size: 12px; color: #ccc; }
.k-tab th { font-size: 10px; font-weight: 500; color: #8b8b99; text-align: right; padding: 0 0 2px; }
.k-tab td { padding: 2px 0 2px 10px; text-align: right; }
.k-tab td:first-child { text-align: left; padding-left: 0; }
.k-tab tr.k-you td { color: #fff; font-weight: 600; }
.k-tab .k-war { color: #f87171; font-size: 10px; font-weight: 600; margin-left: 4px; }
.k-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.k-sel button { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; margin-top: 5px; padding: 7px 10px; font-size: 13px; text-align: left; box-sizing: border-box; }
/* Button = name on top (one line), cost or reason underneath in small grey text */
.k-sel button > span { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.k-sel button small { opacity: 0.7; font-size: 11px; line-height: 1.3; }
.k-sel button small:empty { display: none; }
.k-sel .k-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px; }
.k-sel .k-grid button { margin-top: 0; min-width: 0; }
.k-sel .k-titlebtn { display: inline-block; width: auto; margin: 0 0 0 6px; font-size: 11px; padding: 1px 7px; font-weight: 400; }
.k-tip { position: fixed; pointer-events: none; background: rgba(0,0,0,0.85); border: 1px solid #555; border-radius: 6px; padding: 6px 8px; font-size: 12px; white-space: pre; display: none; }
.k-tip .k-bad { color: #f87171; } .k-tip .k-good { color: #4ade80; }
.k-idle { bottom: 70px; left: 50%; transform: translateX(-50%); display: none; text-align: center; border-color: #eab308; max-width: calc(100vw - 40px); box-sizing: border-box; }
.k-idle .k-idle-btns { display: flex; gap: 6px; justify-content: center; margin-top: 8px; flex-wrap: wrap; }
.k-idle button.k-main { background: #2563eb; border-color: #60a5fa; }
.k-over { inset: 0; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); pointer-events: auto; position: absolute; }
.k-over .k-panel { position: static; text-align: center; padding: 24px 32px; font-size: 16px; }
.k-over h1 { margin: 0 0 8px; }
.k-who { font-weight: 600; margin-left: 6px; }
.k-pass { inset: 0; display: none; align-items: center; justify-content: center; background: rgba(5,10,20,0.92); pointer-events: auto; position: absolute; }
.k-pass .k-panel { position: static; text-align: center; padding: 26px 34px; font-size: 16px; min-width: 240px; border-width: 2px; }
.k-pass h1 { margin: 0 0 6px; font-size: 30px; }
.k-pass .k-sub2 { color: #9ca3af; font-size: 13px; }
.k-pass button { margin-top: 18px; color: #fff; border: 0; padding: 10px 26px; font-size: 16px; font-weight: 600; }
.k-over button { margin-top: 16px; background: #2563eb; color: #fff; border: 0; padding: 8px 18px; }
.k-dlg { inset: 0; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.55); pointer-events: auto; position: absolute; }
.k-dlg .k-panel { position: static; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 18px; border-width: 2px; }
.k-dlg h2 { margin: 0 0 8px; font-size: 18px; display: flex; align-items: center; }
.k-dlg h2 .k-dot { width: 12px; height: 12px; margin-right: 8px; }
.k-dlg p { margin: 6px 0; font-size: 13px; color: #cbd5e1; }
.k-dlg .k-dlg-btns { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.k-dlg button { width: 100%; padding: 9px 12px; text-align: center; }
.k-dlg button small { display: block; opacity: 0.75; font-size: 11px; }
.k-dlg button.k-danger { background: #b91c1c; border-color: #ef4444; color: #fff; }
.k-dlg button.k-main { background: #2563eb; border-color: #60a5fa; color: #fff; }
/* Panel headers are drag handles (move the panel) and click targets (minimize) */
.k-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; font-weight: 600; }
.k-head .k-tog { display: inline-block; width: auto; margin: 0; background: transparent; border: 1px solid #444; border-radius: 4px; padding: 0 7px; font-size: 13px; line-height: 18px; color: #bbb; }
.k-dragging { box-shadow: 0 8px 24px rgba(0,0,0,0.55); border-color: #60a5fa; }
.k-dragging .k-head { cursor: grabbing; }
.k-body { margin-top: 6px; }
.k-collapsed .k-body { display: none; }
.k-collapsed { padding: 6px 10px; }
@media (max-width: 700px) {
  .k-hud { font-size: 12px; }
  .k-stats { min-width: 0; max-width: 46vw; }
  .k-help { max-width: 46vw; }
  .k-bar { flex-wrap: wrap; justify-content: center; width: calc(100% - 40px); bottom: 8px; padding: 6px; }
  .k-hud button { padding: 6px 8px; }
  .k-sel { top: auto; right: auto; left: 12px; bottom: 120px; width: 210px; max-height: calc(100% - 180px); }
  .k-idle { bottom: 120px; }
  .k-sel .k-grid { grid-template-columns: 1fr; }
}
/* Phones sideways: not much height, so the selection panel runs down the right side and scrolls */
@media (orientation: landscape) and (max-height: 500px) {
  .k-sel { left: auto; right: max(8px, env(safe-area-inset-right)); top: 52px; bottom: auto; width: 230px; max-height: calc(100% - 60px); }
  .k-stats { max-height: calc(100% - 70px); overflow-y: auto; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
}
`;

const UI_KEY = 'kingdom-ui';
const POS_KEY = 'kingdom-pos';
const OPEN_KEY = 'kingdom-open-section';

// The one open section in the city panel (Train to start)
function loadOpenSection(): string | null {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    return v === null ? 'Train' : v || null;
  } catch {
    return 'Train';
  }
}

function saveOpenSection(name: string | null): void {
  try {
    localStorage.setItem(OPEN_KEY, name ?? '');
  } catch {
    // ignore
  }
}

type Pos = { x: number; y: number };

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function loadPositions(): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as Record<string, Pos>;
  } catch {
    return {};
  }
}

function savePosition(key: string, pos: Pos | null): void {
  try {
    const all = loadPositions();
    if (pos) all[key] = pos;
    else delete all[key];
    localStorage.setItem(POS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

// A panel with a header that hides/shows its body when clicked and moves the panel when dragged.
// Double-click the header to put the panel back where it started. Positions are remembered.
class Collapsible {
  readonly panel: HTMLDivElement;
  readonly head: HTMLSpanElement;
  readonly body: HTMLDivElement;
  private tog: HTMLButtonElement;
  private pos: Pos | null = null; // null = default CSS spot
  private dragged = false; // the last press was a drag, so its click shouldn't minimize

  constructor(className: string, key: string, defaultCollapsed: boolean, prefs: Record<string, boolean>) {
    this.panel = el(className);
    const headRow = el('k-head');
    headRow.title = 'Drag to move \u00b7 double-click to reset';
    this.head = document.createElement('span');
    this.tog = document.createElement('button');
    this.tog.className = 'k-tog';
    headRow.appendChild(this.head);
    headRow.appendChild(this.tog);
    this.body = el('k-body');
    this.panel.appendChild(headRow);
    this.panel.appendChild(this.body);
    const set = (collapsed: boolean) => {
      this.panel.classList.toggle('k-collapsed', collapsed);
      this.tog.textContent = collapsed ? '+' : '\u2013';
      this.tog.title = collapsed ? 'Expand' : 'Minimize';
    };
    set(prefs[key] ?? defaultCollapsed);
    headRow.onclick = () => {
      if (this.dragged) {
        this.dragged = false;
        return;
      }
      const collapsed = !this.panel.classList.contains('k-collapsed');
      set(collapsed);
      prefs[key] = collapsed;
      saveCollapsed(prefs);
      this.tog.blur();
      this.place(); // keep it on screen if it grew
    };
    this.pos = loadPositions()[key] ?? null;
    this.makeMovable(headRow, key);
  }

  // Re-apply the saved spot, kept inside the window (call after showing or resizing)
  place(): void {
    if (this.pos) this.moveTo(this.pos.x, this.pos.y);
  }

  private moveTo(x: number, y: number): Pos {
    const p = this.panel;
    const w = Math.min(p.offsetWidth, window.innerWidth);
    const headH = 36; // always leave the header reachable
    const nx = Math.round(Math.max(0, Math.min(window.innerWidth - w, x)));
    const ny = Math.round(Math.max(0, Math.min(window.innerHeight - headH, y)));
    p.style.left = `${nx}px`;
    p.style.top = `${ny}px`;
    p.style.right = 'auto';
    p.style.bottom = 'auto';
    p.style.transform = 'none';
    p.style.maxHeight = `${Math.max(headH, window.innerHeight - ny - 8)}px`;
    p.style.overflowY = 'auto';
    return { x: nx, y: ny };
  }

  private reset(key: string): void {
    this.pos = null;
    const s = this.panel.style;
    s.left = s.top = s.right = s.bottom = s.transform = s.maxHeight = s.overflowY = '';
    savePosition(key, null);
  }

  private makeMovable(handle: HTMLElement, key: string): void {
    let start: { px: number; py: number; x: number; y: number; id: number } | null = null;
    const onTitleButton = (e: Event) => !!(e.target as HTMLElement).closest('.k-titlebtn');
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || onTitleButton(e)) return;
      const r = this.panel.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, x: r.left, y: r.top, id: e.pointerId };
      this.dragged = false;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!this.dragged && Math.hypot(dx, dy) < 6) return; // small wiggle = still a click
      if (!this.dragged) {
        this.dragged = true;
        this.panel.classList.add('k-dragging');
      }
      this.pos = this.moveTo(start.x + dx, start.y + dy);
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      this.panel.classList.remove('k-dragging');
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      if (this.dragged && this.pos) savePosition(key, this.pos);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    // Double-click also fires two clicks (minimize + expand), so the panel ends up as it was, just moved home
    handle.addEventListener('dblclick', (e) => {
      if (onTitleButton(e)) return;
      this.reset(key);
    });
  }
}

export class Hud {
  private root: HTMLDivElement;
  private stats: HTMLDivElement;
  private tip: HTMLDivElement;
  private over: HTMLDivElement;
  private overText: HTMLDivElement;
  private help: HTMLDivElement;
  private sel: HTMLDivElement;
  private statsBox: Collapsible;
  private helpBox: Collapsible;
  private selBox: Collapsible;
  private modeBtns = new Map<BarMode, HTMLButtonElement>();
  private idle: HTMLDivElement;
  private prefs: Record<string, boolean>; // collapsed panels and panel sections
  private pass: HTMLDivElement; // hot-seat: "pass the device" screen between people
  private passStart: (() => void) | null = null;
  private dlg: HTMLDivElement; // popup (diplomacy, war news)
  private openSec: string | null = loadOpenSection(); // panels with many sections show only this one

  constructor(handlers: HudHandlers) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('k-hud');
    document.body.appendChild(this.root);

    const prefs = loadCollapsed();
    this.prefs = prefs;

    this.statsBox = new Collapsible('k-panel k-stats', 'stats', false, prefs);
    this.stats = this.statsBox.body;
    this.root.appendChild(this.statsBox.panel);

    // Starts minimized so it doesn't cover the map; open it when you need it
    this.helpBox = new Collapsible('k-panel k-help', 'help2', true, prefs);
    this.helpBox.head.textContent = 'How to play';
    this.help = this.helpBox.body;
    this.root.appendChild(this.helpBox.panel);

    this.selBox = new Collapsible('k-panel k-sel', 'sel', false, prefs);
    this.sel = this.selBox.body;
    this.root.appendChild(this.selBox.panel);
    this.selBox.panel.style.display = 'none';

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

    this.idle = el('k-panel k-idle');
    this.root.appendChild(this.idle);

    this.dlg = el('k-dlg');
    this.dlg.onclick = (e) => {
      if (e.target === this.dlg) this.hideDialog(); // tap outside the box
    };
    this.root.appendChild(this.dlg);

    this.pass = el('k-pass');
    this.root.appendChild(this.pass);

    this.over = el('k-over');
    const box = el('k-panel');
    this.overText = el('');
    box.appendChild(this.overText);
    box.appendChild(button('Back to menu', () => handlers.onMenu()));
    this.over.appendChild(box);
    this.root.appendChild(this.over);

    // Keep moved panels on screen when the window changes size (or a phone rotates)
    window.addEventListener('resize', () => this.placePanels());
    this.placePanels();
  }

  private placePanels(): void {
    this.statsBox.place();
    this.helpBox.place();
    if (this.selBox.panel.style.display !== 'none') this.selBox.place();
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
    if (visible) this.placePanels();
  }

  update(state: GameState, mode: string): void {
    const land = state.landCount();
    const cur = state.current; // whoever is playing right now (hot-seat: changes every turn)
    const me = state.players[cur];
    const free = state.options.freeBuild;
    const used = state.foodUsed(cur);
    const made = state.foodMade(cur);
    const left = made - used;
    const modeLabel = state.sandbox
      ? 'Sandbox'
      : state.hotseat
        ? `${state.players.length} players${state.players.some((p) => p.isAI) ? ` · ${DIFFICULTY[state.options.difficulty].label} AI` : ''}`
        : `${DIFFICULTY[state.options.difficulty].label} · ${state.players.length - 1} rival${state.players.length > 2 ? 's' : ''}`;

    const who = state.hotseat
      ? ` <span class="k-who"><span class="k-dot" style="background:#${me.color.toString(16).padStart(6, '0')}"></span>${escape(me.name)}</span>`
      : '';
    this.statsBox.head.innerHTML = `Turn ${state.turn}${who} <span class="k-mode">${modeLabel}</span>`;

    // One row per resource: name, amount, plain-English note
    const row = (icon: string, label: string, value: string, note: string, warn = false) =>
      `<div class="k-resrow"><span class="k-ic">${icon}</span><span class="k-lab">${label}</span>` +
      `<b>${value}</b><span class="k-note${warn ? ' k-warn' : ''}">${note}</span></div>`;
    const foodPct = made > 0 ? Math.min(100, (used / made) * 100) : 100;
    const net = state.income(cur);
    const pay = state.upkeep(cur);
    const goldNote = free
      ? 'free building on'
      : `${net >= 0 ? '+' : ''}${net} next turn${pay ? ` (troops cost ${pay})` : ''}`;
    const mine =
      row('\u{1FA99}', 'Gold', free ? '\u221e' : String(me.gold), goldNote, !free && net < 0) +
      row('\u{1F33E}', 'Food', `${used}/${made}`, left > 0 ? `${left} spare: room for more units` : 'full: build farms', left <= 0) +
      `<div class="k-foodbar"><div style="width:${foodPct}%;background:${left <= 0 ? '#ef4444' : left <= 2 ? '#eab308' : '#22c55e'}"></div></div>` +
      row('\u{1F465}', 'People', String(state.population(cur)), `eat ${state.popFood(cur)} food`) +
      row('\u{1FAA8}', 'Stone', String(me.stone), state.stoneIncome(cur) > 0 ? `+${state.stoneIncome(cur)} next turn` : 'build mines for walls') +
      row('\u{1F40E}', 'Horses', `${state.horsesUsed(cur)}/${state.horsesMade(cur)}`, state.horsesMade(cur) > 0 ? 'knights' : 'build a pasture for knights') +
      row('\u{1F332}', 'Bows', `${state.bowsUsed(cur)}/${state.bowsMade(cur)}`, state.bowsMade(cur) > 0 ? 'archers' : 'plant a forest for archers');

    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const rows = state.players
      .map((p) => {
        const tiles = state.ownedLand(p.id);
        const color = `#${p.color.toString(16).padStart(6, '0')}`;
        const cells = p.alive
          ? `<td>${Math.round((tiles / land) * 100)}%</td><td>${state.cityCount(p.id)}</td><td>${state.unitsOf(p.id).length}</td>`
          : `<td colspan="3">defeated</td>`;
        const war = p.alive && state.atWar(cur, p.id) ? '<span class="k-war">AT WAR</span>' : '';
        return `<tr class="${p.alive ? '' : 'k-dead'}${p.id === cur ? ' k-you' : ''}"><td><span class="k-dot" style="background:${color}"></span>${escape(p.name)}${war}</td>${cells}</tr>`;
      })
      .join('');
    const table = state.sandbox
      ? `<div class="k-res" style="margin-top:6px">${plural(state.cityCount(cur), 'city')} · ${plural(state.unitsOf(cur).length, 'unit')}</div>`
      : `<h4>Kingdoms</h4><table class="k-tab"><tr><th></th><th>Land</th><th>Cities</th><th>Units</th></tr>${rows}</table>`;
    const recent = state.log.slice(-4).reverse().map((l) => escape(l.replace(/^T(\d+): /, 'Turn $1 · ')));
    this.stats.innerHTML =
      mine + table + (recent.length ? `<h4>What happened</h4><div class="k-log">${recent.join('<br>')}</div>` : '');

    const uses = DIFFICULTY[state.options.difficulty].builderUses;
    this.help.innerHTML =
      `<h4>Your turn</h4><ul>` +
      `<li>Click a <b>city</b> to train units, build walls (W), claim land (K) or rename it.</li>` +
      `<li>Click a <b>unit</b>, then a lit hex to move. Click it again or Esc to deselect.</li>` +
      `<li><b>Routes:</b> with a unit selected, tap a far hex to see the path and turns, tap it again to go. It walks there by itself each turn (X cancels).</li>` +
      `<li><b>End turn</b> (Space) when you're done.</li></ul>` +
      `<h4>Units</h4><ul>` +
      `<li><b>Builder</b> (hammer): farms (food), pastures (horses), forests (bows), mines (stone), roads, raise/lower land. One job per turn${uses ? `, ${uses} jobs total` : ''}.</li>` +
      `<li>Each pasture lets you keep 2 Knights, each forest 2 Archers. Forests are slow to cross but good cover.</li>` +
      `<li>Troops eat 2 food (Knights 3), workers 1. Farms make 2.</li>` +
      `<li><b>Settler</b> (flag): founds a new city on grass, 3+ hexes from others.</li>` +
      `<li><b>Swordsman</b> beats Archer, <b>Archer</b> (shoots 2 hexes) beats Knight, <b>Knight</b> (fast) beats Swordsman.</li>` +
      `<li>Units heal 25% per turn on your land.</li></ul>` +
      `<h4>Land & war</h4><ul>` +
      `<li>Each city owns land up to ${CLAIM_RADIUS} hexes away (4 once it grows into a City). Buy more from the city's Claim land.</li>` +
      `<li><b>Cities grow</b> from spare food: each level (dots on the name tag) adds gold, food and HP.</li>` +
      `<li><b>War:</b> tap a rival's capital to declare war (it lasts at least 5 turns) or offer peace.</li>` +
      `<li>Break a city to 0 HP (red hexes = attack), then walk a Swordsman or Knight in to take it and all its land.</li>` +
      `<li>Walls (built in the city with stone) add a blue bar that soaks damage first. Cities don't heal while enemies are within 2 hexes.</li></ul>`;

    for (const [id, b] of this.modeBtns) b.classList.toggle('k-on', id === mode);

    if (state.winner !== null) {
      const w = state.players[state.winner];
      const title = state.hotseat ? (w.isAI ? `${w.name} wins` : `${w.name} wins!`) : w.isAI ? 'Defeat' : 'Victory';
      this.overText.innerHTML = `<h1>${escape(title)}</h1>${escape(state.winReason)}`;
      this.over.style.display = 'flex';
    } else {
      this.over.style.display = 'none';
    }
  }

  showPanel(model: PanelModel | null): void {
    if (!model) {
      this.selBox.panel.style.display = 'none';
      return;
    }
    this.sel.innerHTML = '';
    this.selBox.head.textContent = model.title;
    if (model.titleAction) {
      const act = model.titleAction;
      const b = document.createElement('button');
      b.className = 'k-titlebtn';
      b.textContent = act.label;
      b.onclick = (e) => {
        e.stopPropagation(); // don't collapse the panel
        b.blur();
        act.onClick();
      };
      this.selBox.head.appendChild(b);
    }
    if (model.subtitle) {
      const sub = el('k-sub');
      sub.textContent = model.subtitle;
      this.sel.appendChild(sub);
    }
    // Lots of sections (the city panel): open one at a time, like an accordion. Fewer: fold each on its own.
    const accordion = model.sections.filter((s) => s.heading).length >= 4;
    for (const sec of model.sections) {
      const box = el('k-sec');
      // Sections with a heading can be folded; the choice is remembered per heading
      const key = sec.heading ? `sec:${sec.heading}` : '';
      const folded =
        key !== '' && (accordion ? sec.heading !== this.openSec : (this.prefs[key] ?? sec.folded ?? false) === true);
      if (sec.heading) {
        const h = document.createElement('h4');
        h.className = folded ? 'k-fold' : 'k-fold k-open';
        h.innerHTML =
          `<span><i class="k-chev">${folded ? '\u25B8' : '\u25BE'}</i>${escape(sec.heading)}</span>` +
          (sec.summary ? `<small>${escape(sec.summary)}</small>` : '');
        h.onclick = () => {
          if (accordion) {
            this.openSec = folded ? sec.heading! : null;
            saveOpenSection(this.openSec);
          } else {
            this.prefs[key] = !folded;
            saveCollapsed(this.prefs);
          }
          this.showPanel(model);
        };
        box.appendChild(h);
      }
      if (folded) {
        this.sel.appendChild(box);
        continue;
      }
      for (const bar of sec.bars ?? []) {
        const row = el('k-meter');
        const pct = bar.max > 0 ? Math.max(0, Math.min(100, (bar.value / bar.max) * 100)) : 0;
        row.innerHTML =
          `<span>${escape(bar.label)}</span><div class="k-track"><div class="k-fill" style="width:${pct}%;background:${bar.color}"></div></div>` +
          `<span>${bar.value}/${bar.max}</span>`;
        box.appendChild(row);
      }
      if (sec.lines?.length) {
        const lines = el('k-lines');
        lines.innerHTML = sec.lines.map(escape).join('<br>');
        box.appendChild(lines);
      }
      const holder = sec.grid && sec.buttons?.length ? el('k-grid') : box;
      if (holder !== box) box.appendChild(holder);
      for (const b of sec.buttons ?? []) {
        const btn = button(
          `<span>${b.key ? `<kbd>${b.key}</kbd>` : ''}${escape(b.label)}</span><small>${escape(b.hint)}</small>`,
          b.onClick,
        );
        btn.disabled = !b.enabled;
        btn.title = b.hint;
        if (b.active) btn.classList.add('k-on');
        holder.appendChild(btn);
      }
      this.sel.appendChild(box);
    }
    if (model.footer) {
      const f = el('k-foot');
      f.textContent = model.footer;
      this.sel.appendChild(f);
    }
    this.selBox.panel.style.display = 'block';
    this.selBox.place();
  }

  // ---------- popup ----------

  showDialog(model: DialogModel): void {
    this.hideTip();
    this.dlg.innerHTML = '';
    const box = el('k-panel');
    const hex = model.color !== undefined ? `#${model.color.toString(16).padStart(6, '0')}` : '';
    if (hex) box.style.borderColor = hex;
    const h = document.createElement('h2');
    h.innerHTML = `${hex ? `<span class="k-dot" style="background:${hex}"></span>` : ''}${escape(model.title)}`;
    box.appendChild(h);
    for (const line of model.lines) {
      const p = document.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    }
    const row = el('k-dlg-btns');
    for (const b of model.buttons) {
      const btn = button(`${escape(b.label)}${b.hint ? `<small>${escape(b.hint)}</small>` : ''}`, b.onClick);
      if (b.kind) btn.className = `k-${b.kind}`;
      btn.disabled = b.enabled === false;
      row.appendChild(btn);
    }
    box.appendChild(row);
    this.dlg.appendChild(box);
    this.dlg.style.display = 'flex';
  }

  hideDialog(): void {
    this.dlg.style.display = 'none';
  }

  get dialogVisible(): boolean {
    return this.dlg.style.display === 'flex';
  }

  // Hot-seat: cover the map until the next person is holding the device.
  showPass(name: string, color: number, turn: number, note: string, onStart: () => void): void {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    this.pass.innerHTML = '';
    const box = el('k-panel');
    box.style.borderColor = hex;
    box.innerHTML = `<div class="k-sub2">Turn ${turn} · pass the device to</div><h1 style="color:${hex}">${escape(name)}</h1><div class="k-sub2">${escape(note)}</div>`;
    const go = button(`<kbd>Space</kbd>I'm ${escape(name)}, start my turn`, () => this.startPass());
    go.style.background = hex;
    box.appendChild(go);
    this.pass.appendChild(box);
    this.passStart = onStart;
    this.pass.style.display = 'flex';
    this.hideTip();
  }

  startPass(): void {
    const fn = this.passStart;
    this.passStart = null;
    this.pass.style.display = 'none';
    fn?.();
  }

  get passVisible(): boolean {
    return this.pass.style.display === 'flex';
  }

  // End-of-turn check: some units still have nothing ordered.
  showIdle(count: number, names: string, h: IdleHandlers): void {
    this.idle.innerHTML = `<b>${count} unit${count > 1 ? 's' : ''} still waiting for orders</b><br><small>${escape(names)}</small>`;
    const row = el('k-idle-btns');
    const show = button('Show me', h.onShow);
    show.className = 'k-main';
    row.appendChild(show);
    row.appendChild(button(count > 1 ? 'Hold them all' : 'Hold it', h.onHoldAll));
    row.appendChild(button('<kbd>Space</kbd>End turn anyway', h.onEndAnyway));
    this.idle.appendChild(row);
    this.idle.style.display = 'block';
  }

  hideIdle(): void {
    this.idle.style.display = 'none';
  }

  get idleVisible(): boolean {
    return this.idle.style.display === 'block';
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
