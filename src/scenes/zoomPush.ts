// Push past the zoom limit to switch screens (task 6). On the map: keep zooming in on your own city once the map
// is at its max zoom and the city opens. In the city: keep zooming out past its min zoom and you're back on the map.
// Pure logic (plus a tiny DOM hint), no Phaser, so the "never by accident" rules can be tested on their own.

// Wheel and trackpad: zoom input past the limit piles up and fires once it crosses `need`.
// It drains away when you stop (half of it every `halfLife` ms), only starts counting once the camera has sat at
// its limit for `settle` ms, and nothing counts for `cooldown` ms after a switch.
export const PUSH_NEED = 150; // about 4 mouse-wheel notches past the limit
export const PUSH_HALF_LIFE = 250;
export const PUSH_SETTLE = 120;
export const PUSH_COOLDOWN = 500;
export const TRACKPAD_PINCH = 6; // ctrl+wheel (macOS trackpad pinch) sends small numbers: scale them up

export class ZoomPush {
  private amount = 0;
  private at = 0; // when amount was last updated
  private since = -1; // when the camera started sitting at its limit (-1 = it isn't)
  private coolUntil = 0;

  readonly need: number;
  readonly halfLife: number;
  readonly settle: number;
  readonly cooldown: number;

  constructor(need = PUSH_NEED, halfLife = PUSH_HALF_LIFE, settle = PUSH_SETTLE, cooldown = PUSH_COOLDOWN) {
    this.need = need;
    this.halfLife = halfLife;
    this.settle = settle;
    this.cooldown = cooldown;
  }

  // Is the camera at its limit (and over something you can push into) right now? Leaving it drops the pile.
  atLimit(on: boolean, now: number): void {
    if (!on) {
      this.since = -1;
      this.amount = 0;
    } else if (this.since < 0) this.since = now;
  }

  // How much has piled up, after draining
  level(now: number): number {
    if (this.amount <= 0) return 0;
    return this.amount * Math.pow(0.5, Math.max(0, now - this.at) / this.halfLife);
  }

  // More zoom past the limit (in wheel units). True = switch screens now.
  feed(push: number, now: number): boolean {
    if (this.cooling(now) || this.since < 0 || now - this.since < this.settle || push <= 0) {
      this.amount = 0;
      this.at = now;
      return false;
    }
    this.amount = this.level(now) + push;
    this.at = now;
    if (this.amount < this.need) return false;
    this.cool(now);
    return true;
  }

  // Just switched: ignore leftover input for a moment (trackpad glide)
  cool(now: number): void {
    this.amount = 0;
    this.since = -1;
    this.coolUntil = now + this.cooldown;
  }

  cooling(now: number): boolean {
    return now < this.coolUntil;
  }
}

// Pinch: the fingers spread (or squeeze) past the limit stretches the view a little. Once far enough it's armed,
// and it only fires when the fingers lift, never mid-pinch.
export const PINCH_ARM = 0.25; // about 28% more finger spread past the limit
export const PINCH_MAX = 0.45;
const PINCH_GIVE = 0.35; // how much the view stretches compared to the fingers

export class PinchPush {
  over = 0; // how far past the limit, as the log of the finger spread

  readonly arm: number;
  readonly max: number;

  constructor(arm = PINCH_ARM, max = PINCH_MAX) {
    this.arm = arm;
    this.max = max;
  }

  // ratio > 1 = further past the limit, < 1 = back toward it
  stretch(ratio: number): void {
    if (!(ratio > 0)) return;
    this.over = Math.min(this.max, Math.max(0, this.over + Math.log(ratio)));
  }

  get active(): boolean {
    return this.over > 0;
  }

  get armed(): boolean {
    return this.over >= this.arm;
  }

  // Zoom multiplier for the rubber-band stretch (1 = at the limit)
  get give(): number {
    return Math.exp(this.over * PINCH_GIVE);
  }

  reset(): void {
    this.over = 0;
  }
}

// The small "Release to enter" pill near the top of the screen (null hides it)
let hintEl: HTMLDivElement | null = null;
export function pushHint(msg: string | null): void {
  if (typeof document === 'undefined') return;
  if (!msg) {
    if (hintEl) hintEl.style.display = 'none';
    return;
  }
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.style.cssText =
      'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:36;pointer-events:none;' +
      'background:rgba(15,15,20,0.92);border:1px solid #facc15;color:#fde68a;border-radius:999px;' +
      'padding:6px 14px;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,0.45);white-space:nowrap';
    document.body.appendChild(hintEl);
  }
  hintEl.textContent = msg;
  hintEl.style.display = 'block';
}
