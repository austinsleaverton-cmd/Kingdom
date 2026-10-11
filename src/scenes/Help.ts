// The "?" button (top-right, always visible: start screen and in game) and the rules guide it opens.
// Numbers come straight from src/world so the guide stays right when the rules change.
import {
  ARCHERS_PER_FOREST, BIG_CLAIM_RADIUS, CAPITAL_FOOD, CAPITAL_INCOME, CITY_FOOD, CITY_INCOME, CITY_SPACING, CLAIM_RADIUS,
  DIFFICULTY, FARM_FOOD, HOME_HEAL, KNIGHTS_PER_PASTURE, MINE_STONE, WIN_SHARE,
} from '../world/game';
import type { Difficulty } from '../world/game';
import { CLAIM_COST, GROWTH_NEED, LEVEL_NAMES, MAX_WALLS, WALL_SHIELD, WALL_STONE, YIELD } from '../world/tile';
import { JOB_COST, UNIT_STATS } from '../world/units';

const CSS = `
.k-qbtn { position: fixed; top: max(10px, env(safe-area-inset-top)); right: max(10px, env(safe-area-inset-right)); z-index: 30;
  width: 34px; height: 34px; border-radius: 50%; border: 1px solid #60a5fa; background: rgba(15,15,22,0.92); color: #bfdbfe;
  font: 700 18px/1 system-ui, sans-serif; cursor: pointer; touch-action: manipulation; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
.k-qbtn:hover { background: #1e3a8a; color: #fff; }
.k-guide { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.6);
  font: 14px/1.45 system-ui, sans-serif; color: #e5e7eb; padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); box-sizing: border-box; }
.k-guide-box { background: #12121a; border: 1px solid #333; border-radius: 12px; width: min(620px, 100%); max-height: 100%; display: flex; flex-direction: column; }
.k-guide-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #2a2a35; }
.k-guide-head h2 { margin: 0; font-size: 18px; }
.k-guide-head button { background: #262630; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
.k-guide-body { overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 6px 16px 16px; user-select: text; -webkit-user-select: text; }
.k-guide details { border-bottom: 1px solid #23232d; padding: 6px 0; }
.k-guide summary { cursor: pointer; font-weight: 600; padding: 4px 0; color: #fff; }
.k-guide ul { margin: 4px 0 6px; padding-left: 18px; }
.k-guide li { margin: 3px 0; }
.k-guide table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 6px 0; }
.k-guide th, .k-guide td { border: 1px solid #2c2c38; padding: 4px 6px; text-align: left; vertical-align: top; }
.k-guide th { background: #1b1b26; color: #cbd5e1; }
.k-guide kbd { background: #262630; border: 1px solid #444; border-radius: 4px; padding: 0 5px; font-size: 12px; }
/* The old "How to play" corner panel is replaced by this guide */
.k-help { display: none !important; }
`;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const DIFFS = Object.keys(DIFFICULTY) as Difficulty[];

function difficultyTable(): string {
  const row = (label: string, f: (d: Difficulty) => string) =>
    `<tr><td>${label}</td>${DIFFS.map((d) => `<td>${f(d)}</td>`).join('')}</tr>`;
  const c = (d: Difficulty) => DIFFICULTY[d];
  return (
    `<table><tr><th></th>${DIFFS.map((d) => `<th>${c(d).label}</th>`).join('')}</tr>` +
    row('AI gold', (d) => pct(c(d).income)) +
    row('AI army size', (d) => `up to ${c(d).maxArmy}`) +
    row('AI starts wars', (d) => `turn ${c(d).attackTurn}`) +
    row('AI walls', (d) => `up to ${c(d).maxWalls}`) +
    row('AI tactics', (d) => (c(d).smart ? 'counters your troops, picks off wounded units, retreats to heal' : 'simple')) +
    row('AI goes after', (d) => (c(d).focusHuman ? 'people first' : 'whoever is closest')) +
    row(`AI can win by holding ${pct(WIN_SHARE)} land`, (d) => (c(d).landWin ? 'yes' : 'no')) +
    row('Your builder jobs', (d) => (c(d).builderUses ? `${c(d).builderUses}, then it retires` : 'unlimited')) +
    `</table>`
  );
}

function guideHtml(): string {
  const u = UNIT_STATS;
  const sec = (title: string, body: string, open = false) => `<details${open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  return [
    sec(
      'Goal',
      `<ul><li>Grow a kingdom: claim land, found cities, build farms and armies.</li>` +
        `<li><b>Win</b> by taking every rival capital, or by holding ${pct(WIN_SHARE)} of all land.</li>` +
        `<li>Lose your capital and you're out.</li></ul>`,
      true,
    ),
    sec(
      'A turn',
      `<ul><li>Tap a <b>city</b> to train units, build walls or claim land. Tap a <b>unit</b>, then a lit hex to move it.</li>` +
        `<li>Red hexes are attacks. Tap the unit again (or Esc) to deselect.</li>` +
        `<li>When a unit is done, the next unit that can still act is picked for you.</li>` +
        `<li><b>End turn</b> (Space). If some units have no orders you get asked first; <b>Hold</b> a unit to skip it.</li></ul>`,
    ),
    sec(
      'Gold, food, stone',
      `<ul><li><b>Gold</b> each turn: land (grass/sand ${YIELD.grass}, hills ${YIELD.hills}, mountains ${YIELD.mountain}) + ${CITY_INCOME} per city (${CAPITAL_INCOME} for the capital) + 1 per city level above 1.</li>` +
        `<li><b>Food</b> is a limit, not a pile: capital ${CAPITAL_FOOD}, each city ${CITY_FOOD}, each farm ${FARM_FOOD}, +1 per city level. Every unit uses some (below). Spare food makes cities grow.</li>` +
        `<li><b>Stone</b>: each mine makes ${MINE_STONE} a turn. Used for walls.</li>` +
        `<li><b>Horses</b>: each pasture supports ${KNIGHTS_PER_PASTURE} Knights. <b>Bows</b>: each forest supports ${ARCHERS_PER_FOREST} Archers.</li></ul>`,
    ),
    sec(
      'Cities and land',
      `<ul><li>Settlers found cities on <b>grass</b>, at least ${CITY_SPACING} hexes from any other city.</li>` +
        `<li>Each city owns land around it. <b>Claim land</b> (city panel) buys more within ${CLAIM_RADIUS} hexes (${BIG_CLAIM_RADIUS} once it's a ${LEVEL_NAMES[2]}). ` +
        `Grass ${CLAIM_COST.grass}g, sand ${CLAIM_COST.sand}g, hills ${CLAIM_COST.hills}g, mountains ${CLAIM_COST.mountain}g, a little more each time.</li>` +
        `<li><b>Growth</b>: spare food fills a city's growth bar (${GROWTH_NEED.join(' / ')}). Levels: ${LEVEL_NAMES.join(', ')}. Each level adds gold, food and health; a ${LEVEL_NAMES[4]} trains troops a turn faster.</li>` +
        `<li><b>Walls</b> (city panel): up to ${MAX_WALLS} levels for ${JOB_COST.walls}g + ${WALL_STONE.join('/')} stone. Each level adds a ${WALL_SHIELD} point shield that soaks damage first.</li>` +
        `<li>Cities heal every turn unless enemy troops are within 2 hexes (a siege), and don't grow under siege.</li></ul>`,
    ),
    sec(
      'Builders',
      `<ul><li>A builder does one job per turn on the tile it stands on (your land only).</li>` +
        `<li>Farm ${JOB_COST.farm}g (grass or sand), Pasture ${JOB_COST.pasture}g and Forest ${JOB_COST.forest}g (grass), Mine ${JOB_COST.mine}g (hills or mountains), Road ${JOB_COST.road}g, Raise/Lower land ${JOB_COST.raise}g.</li>` +
        `<li>A new job replaces what was there. Roads (and cities) cut movement cost to half.</li>` +
        `<li>Raising and lowering land changes the terrain: water, sand, grass, hills, mountain.</li>` +
        `<li>Forests cost 2 moves to cross and give cover like hills.</li></ul>`,
    ),
    sec(
      'Units and fighting',
      `<table><tr><th>Unit</th><th>Gold</th><th>Food</th><th>Moves</th><th>HP</th><th>Attack</th><th>Notes</th></tr>` +
        `<tr><td>Builder</td><td>${u.builder.cost}</td><td>${u.builder.food}</td><td>${u.builder.moves}</td><td>${u.builder.hp}</td><td>-</td><td>builds, ready at once</td></tr>` +
        `<tr><td>Settler</td><td>grows</td><td>${u.settler.food}</td><td>${u.settler.moves}</td><td>${u.settler.hp}</td><td>-</td><td>founds a city, ${u.settler.train} turns</td></tr>` +
        `<tr><td>Swordsman</td><td>${u.swordsman.cost}</td><td>${u.swordsman.food}</td><td>${u.swordsman.moves}</td><td>${u.swordsman.hp}</td><td>${u.swordsman.atk}</td><td>beats Archers, can capture cities</td></tr>` +
        `<tr><td>Archer</td><td>${u.archer.cost}</td><td>${u.archer.food}</td><td>${u.archer.moves}</td><td>${u.archer.hp}</td><td>${u.archer.atk}</td><td>shoots 2 hexes, beats Knights, needs bows</td></tr>` +
        `<tr><td>Knight</td><td>${u.knight.cost}</td><td>${u.knight.food}</td><td>${u.knight.moves}</td><td>${u.knight.hp}</td><td>${u.knight.atk}</td><td>fast, beats Swordsmen, captures, needs horses, weak vs walls</td></tr></table>` +
        `<ul><li>Each unit can attack once per turn. Close-up fights hit back.</li>` +
        `<li>Hills, forests and your own cities protect defenders.</li>` +
        `<li>Units heal ${pct(HOME_HEAL)} a turn on your own land, not in the field.</li>` +
        `<li>Break a city to 0 HP, then walk a Swordsman or Knight in to take it and all its land.</li></ul>`,
    ),
    sec(
      'Routes (multi-turn moves)',
      `<ul><li>With a unit selected, tap a far hex: you see the path, a numbered dot where it stops each turn, and how many turns it takes.</li>` +
        `<li>Tap the same hex again to send it. It walks by itself at the start of each turn.</li>` +
        `<li>It waits if your own unit is in the way (then goes around), stops if enemy troops come within 2 hexes, and never attacks by itself.</li>` +
        `<li><kbd>X</kbd> or any manual move cancels a route.</li></ul>`,
    ),
    sec(
      'Playing together (hot-seat)',
      `<ul><li>On the start screen, set each kingdom to <b>Person</b> or <b>AI</b> and type names.</li>` +
        `<li>People take turns on the same device. A "pass the device" screen shows between turns.</li>` +
        `<li>Difficulty only changes the AI kingdoms.</li></ul>`,
    ),
    sec('Difficulty', `<p>Difficulty mostly changes how the computer plays. People always use the same rules.</p>${difficultyTable()}`),
    sec(
      'Controls',
      `<ul><li>Drag to move the map, pinch or scroll to zoom.</li>` +
        `<li><kbd>Space</kbd> end turn, <kbd>N</kbd>/<kbd>Tab</kbd> next unit, <kbd>H</kbd> hold, <kbd>X</kbd> cancel route, <kbd>Esc</kbd> deselect / menu.</li>` +
        `<li>City: <kbd>B</kbd> builder, <kbd>S</kbd> settler, <kbd>W</kbd> walls, <kbd>K</kbd> claim land.</li>` +
        `<li>Builder: <kbd>F</kbd> farm, <kbd>P</kbd> pasture, <kbd>T</kbd> forest, <kbd>M</kbd> mine, <kbd>R</kbd> road, <kbd>U</kbd>/<kbd>D</kbd> raise/lower. Settler: <kbd>C</kbd> found city.</li></ul>`,
    ),
  ].join('');
}

export function installHelp(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const guide = document.createElement('div');
  guide.className = 'k-guide';
  guide.innerHTML =
    `<div class="k-guide-box"><div class="k-guide-head"><h2>How Kingdom works</h2><button type="button">Close</button></div>` +
    `<div class="k-guide-body">${guideHtml()}</div></div>`;
  document.body.appendChild(guide);

  const btn = document.createElement('button');
  btn.className = 'k-qbtn';
  btn.type = 'button';
  btn.textContent = '?';
  btn.title = 'How to play';
  btn.setAttribute('aria-label', 'How to play');
  document.body.appendChild(btn);

  const isOpen = () => guide.style.display === 'flex';
  const close = () => {
    guide.style.display = 'none';
  };
  btn.onclick = () => {
    btn.blur();
    guide.style.display = isOpen() ? 'none' : 'flex';
  };
  (guide.querySelector('.k-guide-head button') as HTMLButtonElement).onclick = close;
  guide.onclick = (e) => {
    if (e.target === guide) close(); // tap outside the box
  };
  // While the guide is open, keys belong to it (Esc closes it instead of opening the game menu)
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') close();
      e.stopImmediatePropagation();
    },
    true,
  );
}
