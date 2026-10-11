// Start screen (DOM overlay): pick map size, players (people or AI), difficulty, free building, or continue a save.
import { DIFFICULTY, MAP_SIZES, MAX_NAME, MAX_OPPONENTS, PLAYER_INFO, defaultOptions, randomSeed } from '../world/game';
import type { Difficulty, GameOptions, MapSize, Seat } from '../world/game';
import type { SaveSummary } from '../world/save';

const CSS = `
.k-menu { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, rgba(20,40,70,0.85), rgba(5,10,20,0.97)); font: 15px/1.4 system-ui, sans-serif; color: #eee; z-index: 10; }
.k-menu-box { background: rgba(15,15,22,0.95); border: 1px solid #333; border-radius: 12px; padding: 28px 32px; width: 380px; }
.k-menu h1 { margin: 0 0 4px; font-size: 34px; letter-spacing: 2px; }
.k-menu .k-sub { color: #999; margin-bottom: 20px; font-size: 13px; }
.k-menu h3 { margin: 16px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #aaa; }
.k-seg { display: flex; gap: 6px; }
.k-seg button { flex: 1; background: #262630; color: #ddd; border: 1px solid #444; border-radius: 6px; padding: 8px 0; font: inherit; cursor: pointer; }
.k-seg button.k-on { background: #2563eb; border-color: #60a5fa; color: #fff; }
.k-seg button:disabled { opacity: 0.35; cursor: default; }
.k-menu label { display: flex; gap: 8px; align-items: center; margin-top: 14px; cursor: pointer; }
.k-menu .k-note { color: #8a8a8a; font-size: 12px; margin-top: 6px; min-height: 32px; }
.k-menu .k-go { width: 100%; margin-top: 18px; padding: 11px; border: 0; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; background: #15803d; color: #fff; }
.k-menu .k-cont { background: #2563eb; margin-top: 10px; }
.k-menu .k-cont small { font-weight: 400; opacity: 0.8; }
.k-seat { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.k-seat .k-sw { width: 14px; height: 14px; border-radius: 50%; flex: none; }
.k-seat input { flex: 1; min-width: 0; background: #1b1b24; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 7px 8px; font: inherit; }
.k-seat button { background: #262630; color: #ddd; border: 1px solid #444; border-radius: 6px; padding: 7px 10px; font: inherit; cursor: pointer; flex: none; }
.k-seat button.k-human { background: #2563eb; border-color: #60a5fa; color: #fff; width: 76px; }
.k-seat button.k-ai { width: 76px; }
.k-seat button:disabled { opacity: 0.35; cursor: default; }
.k-add { margin-top: 8px; background: transparent; color: #93c5fd; border: 1px dashed #3b4a66; border-radius: 6px; padding: 7px; width: 100%; font: inherit; cursor: pointer; }
.k-menu { overflow-y: auto; -webkit-overflow-scrolling: touch; }
@media (max-width: 480px) { .k-menu-box { width: calc(100vw - 32px); padding: 20px; box-sizing: border-box; } }
@media (max-height: 760px), (max-width: 480px) { .k-menu { align-items: flex-start; padding: 16px 0; box-sizing: border-box; } }
`;

const SEATS_KEY = 'kingdom-seats'; // remembers names between games

function loadSeats(): Seat[] {
  try {
    const s = JSON.parse(localStorage.getItem(SEATS_KEY) ?? 'null') as Seat[] | null;
    if (Array.isArray(s) && s.length >= 1 && s.length <= MAX_OPPONENTS + 1) {
      return s.map((x, i) => ({ name: String(x.name ?? '').slice(0, MAX_NAME), human: i === 0 ? true : !!x.human }));
    }
  } catch {
    // ignore
  }
  return [
    { name: 'You', human: true },
    { name: PLAYER_INFO[1].name, human: false },
  ];
}

function saveSeats(seats: Seat[]): void {
  try {
    localStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  } catch {
    // ignore
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Menu {
  private root: HTMLDivElement;
  private opts: GameOptions = defaultOptions();
  private sizeBtns = new Map<MapSize, HTMLButtonElement>();
  private seats: Seat[] = loadSeats();
  private seatBox!: HTMLDivElement;
  private diffBtns = new Map<Difficulty, HTMLButtonElement>();
  private free: HTMLInputElement;
  private note: HTMLDivElement;
  private cont: HTMLButtonElement;

  constructor(onStart: (opts: GameOptions) => void, onContinue: () => void) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'k-menu';
    const box = document.createElement('div');
    box.className = 'k-menu-box';
    box.innerHTML = '<h1>KINGDOM</h1><div class="k-sub">Shape the land. Build your realm.</div>';

    this.cont = document.createElement('button');
    this.cont.className = 'k-go k-cont';
    this.cont.onclick = () => onContinue();
    box.appendChild(this.cont);

    box.appendChild(heading('Map size'));
    const sizes = segment();
    for (const key of Object.keys(MAP_SIZES) as MapSize[]) {
      const b = segButton(MAP_SIZES[key].label, () => {
        this.opts.size = key;
        this.refresh();
      });
      this.sizeBtns.set(key, b);
      sizes.appendChild(b);
    }
    box.appendChild(sizes);

    // Players: one row per kingdom. People take turns on this device (hot-seat); AI plays itself.
    box.appendChild(heading('Players'));
    this.seatBox = document.createElement('div');
    box.appendChild(this.seatBox);

    box.appendChild(heading('Difficulty'));
    const diffs = segment();
    for (const key of Object.keys(DIFFICULTY) as Difficulty[]) {
      const b = segButton(DIFFICULTY[key].label, () => {
        this.opts.difficulty = key;
        this.refresh();
      });
      this.diffBtns.set(key, b);
      diffs.appendChild(b);
    }
    box.appendChild(diffs);

    const label = document.createElement('label');
    this.free = document.createElement('input');
    this.free.type = 'checkbox';
    this.free.onchange = () => {
      this.opts.freeBuild = this.free.checked;
      this.refresh();
    };
    label.appendChild(this.free);
    label.appendChild(document.createTextNode('Free building (people pay no gold)'));
    box.appendChild(label);

    this.note = document.createElement('div');
    this.note.className = 'k-note';
    box.appendChild(this.note);

    const go = document.createElement('button');
    go.className = 'k-go';
    go.textContent = 'New kingdom';
    go.onclick = () => {
      const seats = this.seats.map((s, i) => ({ name: s.name.trim() || defaultName(i, s.human), human: s.human }));
      onStart({ ...this.opts, opponents: seats.length - 1, seats, seed: randomSeed() });
    };
    box.appendChild(go);

    this.root.appendChild(box);
    document.body.appendChild(this.root);
    this.renderSeats();
    this.refresh();
  }

  // Rebuilt on add/remove/toggle; typing a name only updates the data (keeps the cursor)
  private renderSeats(): void {
    const box = this.seatBox;
    box.innerHTML = '';
    this.seats.forEach((seat, i) => {
      const row = document.createElement('div');
      row.className = 'k-seat';
      const sw = document.createElement('span');
      sw.className = 'k-sw';
      sw.style.background = hex(PLAYER_INFO[i].color);
      row.appendChild(sw);
      const input = document.createElement('input');
      input.value = seat.name;
      input.maxLength = MAX_NAME;
      input.placeholder = defaultName(i, seat.human);
      input.oninput = () => {
        seat.name = input.value;
        saveSeats(this.seats);
      };
      // keys typed into a name shouldn't reach the game
      input.onkeydown = (e) => e.stopPropagation();
      row.appendChild(input);
      const kind = document.createElement('button');
      kind.textContent = seat.human ? 'Person' : 'AI';
      kind.className = seat.human ? 'k-human' : 'k-ai';
      kind.title = i === 0 ? 'The first player is always a person' : 'Switch between a person and the computer';
      kind.disabled = i === 0;
      kind.onclick = () => {
        seat.human = !seat.human;
        // swap a default name for the other kind's default
        if (!seat.human && (seat.name === '' || /^Player \d$/.test(seat.name))) seat.name = PLAYER_INFO[i].name;
        else if (seat.human && seat.name === PLAYER_INFO[i].name) seat.name = `Player ${i + 1}`;
        this.changedSeats();
      };
      row.appendChild(kind);
      const del = document.createElement('button');
      del.textContent = '\u2715';
      del.title = 'Remove';
      del.disabled = i === 0;
      del.onclick = () => {
        this.seats.splice(i, 1);
        this.changedSeats();
      };
      row.appendChild(del);
      box.appendChild(row);
    });
    if (this.seats.length <= MAX_OPPONENTS) {
      const add = document.createElement('button');
      add.className = 'k-add';
      add.textContent = '+ Add player';
      add.onclick = () => {
        const i = this.seats.length;
        this.seats.push({ name: PLAYER_INFO[i].name, human: false });
        this.changedSeats();
      };
      box.appendChild(add);
    }
  }

  private changedSeats(): void {
    saveSeats(this.seats);
    this.renderSeats();
    this.refresh();
  }

  show(save: SaveSummary | null): void {
    if (save) {
      const mode =
        save.people.length > 1
          ? save.people.map(esc).join(' vs ')
          : save.opponents === 0
            ? 'Sandbox'
            : `${save.opponents} rival${save.opponents > 1 ? 's' : ''} · ${DIFFICULTY[save.difficulty].label}`;
      this.cont.innerHTML = `Continue <small>· Turn ${save.turn} · ${save.sizeLabel} · ${mode}${save.finished ? ' · finished' : ''}</small>`;
      this.cont.style.display = 'block';
    } else {
      this.cont.style.display = 'none';
    }
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display === 'flex';
  }

  private refresh(): void {
    for (const [k, b] of this.sizeBtns) b.classList.toggle('k-on', k === this.opts.size);
    const ais = this.seats.filter((s) => !s.human).length;
    const people = this.seats.length - ais;
    for (const [k, b] of this.diffBtns) {
      b.classList.toggle('k-on', k === this.opts.difficulty && ais > 0);
      b.disabled = ais === 0;
    }
    this.free.checked = this.opts.freeBuild;
    const { width, height } = MAP_SIZES[this.opts.size];
    const map = `${width}x${height} map`;
    const aiNote = ais > 0 ? ` ${ais} AI: ${DIFFICULTY[this.opts.difficulty].note}` : '';
    this.note.textContent =
      this.seats.length === 1
        ? `Sandbox: just you on a ${map}. No rivals, no turn pressure, build however you like.`
        : people > 1
          ? `${people} people take turns on this device (pass it after each turn) on a ${map}.${aiNote}`
          : `${ais} AI rival${ais > 1 ? 's' : ''} on a ${map}. ${DIFFICULTY[this.opts.difficulty].note}`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function defaultName(i: number, human: boolean): string {
  if (i === 0) return 'You';
  return human ? `Player ${i + 1}` : PLAYER_INFO[i].name;
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

function segment(): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'k-seg';
  return d;
}

function segButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = () => {
    b.blur();
    onClick();
  };
  return b;
}
