import type { GameOptions } from '../world/game';
import { Menu } from './Menu';
interface MenuBridge {
  root: HTMLDivElement; opts: GameOptions; seats: { human: boolean }[];
  refresh(): void;
}
let installed = false;
export function installRaidMenu(): void {
  if (installed) return;
  installed = true;
  const p = Menu.prototype as unknown as MenuBridge, refresh = p.refresh;
  p.refresh = function() {
    const box = this.root.querySelector<HTMLElement>('.k-a-diff');
    if (box && !box.querySelector('[data-barbarians]')) {
      this.opts.barbarians = this.opts.barbarians !== false;
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.dataset.barbarians = ''; input.checked = this.opts.barbarians;
      input.onchange = () => { this.opts.barbarians = input.checked; this.refresh(); };
      label.append(input, document.createTextNode('Barbarian camps and raiders'));
      box.insertBefore(label, box.querySelector('.k-note'));
    }
    refresh.call(this);
    if (this.opts.barbarians) {
      // Difficulty also sets raid cadence, including a one-kingdom game.
      for (const button of box?.querySelectorAll<HTMLButtonElement>('.k-seg button') ?? []) button.disabled = false;
      const note = box?.querySelector<HTMLElement>('.k-note');
      if (note) note.textContent = this.seats.length === 1
        ? 'One kingdom, no victory pressure. Barbarian camps give your army enemies without kingdom wars.'
        : `${note.textContent} Barbarian camps threaten every kingdom; no declaration of war is needed.`;
    }
  };
}
