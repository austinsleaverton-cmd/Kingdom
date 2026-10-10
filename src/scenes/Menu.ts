// Start screen (DOM overlay): pick map size, rivals, free building, or continue a save.
import { MAP_SIZES, MAX_OPPONENTS, defaultOptions, randomSeed } from '../world/game';
import type { GameOptions, MapSize } from '../world/game';
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
.k-menu label { display: flex; gap: 8px; align-items: center; margin-top: 14px; cursor: pointer; }
.k-menu .k-note { color: #8a8a8a; font-size: 12px; margin-top: 6px; min-height: 32px; }
.k-menu .k-go { width: 100%; margin-top: 18px; padding: 11px; border: 0; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; background: #15803d; color: #fff; }
.k-menu .k-cont { background: #2563eb; margin-top: 10px; }
.k-menu .k-cont small { font-weight: 400; opacity: 0.8; }
`;

export class Menu {
  private root: HTMLDivElement;
  private opts: GameOptions = defaultOptions();
  private sizeBtns = new Map<MapSize, HTMLButtonElement>();
  private oppBtns: HTMLButtonElement[] = [];
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

    box.appendChild(heading('Rivals'));
    const opps = segment();
    for (let i = 0; i <= MAX_OPPONENTS; i++) {
      const b = segButton(i === 0 ? 'None' : String(i), () => {
        this.opts.opponents = i;
        this.refresh();
      });
      this.oppBtns.push(b);
      opps.appendChild(b);
    }
    box.appendChild(opps);

    const label = document.createElement('label');
    this.free = document.createElement('input');
    this.free.type = 'checkbox';
    this.free.onchange = () => {
      this.opts.freeBuild = this.free.checked;
      this.refresh();
    };
    label.appendChild(this.free);
    label.appendChild(document.createTextNode('Free building (your actions cost no gold)'));
    box.appendChild(label);

    this.note = document.createElement('div');
    this.note.className = 'k-note';
    box.appendChild(this.note);

    const go = document.createElement('button');
    go.className = 'k-go';
    go.textContent = 'New kingdom';
    go.onclick = () => onStart({ ...this.opts, seed: randomSeed() });
    box.appendChild(go);

    this.root.appendChild(box);
    document.body.appendChild(this.root);
    this.refresh();
  }

  show(save: SaveSummary | null): void {
    if (save) {
      const mode = save.opponents === 0 ? 'Sandbox' : `${save.opponents} rival${save.opponents > 1 ? 's' : ''}`;
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
    this.oppBtns.forEach((b, i) => b.classList.toggle('k-on', i === this.opts.opponents));
    this.free.checked = this.opts.freeBuild;
    const { width, height } = MAP_SIZES[this.opts.size];
    this.note.textContent =
      this.opts.opponents === 0
        ? `Sandbox: just you on a ${width}x${height} map. No rivals, no turn pressure, build however you like.`
        : `${this.opts.opponents} AI rival${this.opts.opponents > 1 ? 's' : ''} on a ${width}x${height} map. Take every rival capital or hold 60% of the land.`;
  }
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
