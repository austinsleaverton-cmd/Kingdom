import { AMENITY_LOOT, MARKET_LOOT, REPAIR_TURNS } from '../world/amenityRaids';
import { CAMP_HP, CAMP_REWARD } from '../world/barbarians';
export function installRaidGuide(): void {
  const body = document.querySelector('.k-guide-body');
  if (!body || body.querySelector('[data-raids-guide]')) return;
  const section = document.createElement('details');
  section.dataset.raidsGuide = '';
  section.innerHTML = `<summary>Raids, pillaged amenities and repairs</summary><ul>
    <li>Amenities occupy their own territory hexes. Troops standing on an enemy amenity can Pillage (L), disabling its base effects, placement bonuses, and support for neighboring amenities. The building, its slot, decorations and the underlying farm or road remain.</li>
    <li>A Market raid steals up to ${MARKET_LOOT} gold from its kingdom. Other amenities give ${AMENITY_LOOT} gold. An already pillaged amenity cannot pay loot again until repaired. Underlying improvements can still be pillaged separately.</li>
    <li>Repair from the city's Repairs section or select the pillaged amenity inside City View. Repairs cost a quarter of its original gold price (rounded up, minimum 5), take ${REPAIR_TURNS} owner turns and use the city's one project slot. Free building makes repairs free, not instant. Enemy occupation pauses repair; capture cancels the old owner's repair.</li>
    <li>Turn Barbarian camps on or off when starting a game. Camps appear only on unexplored, unclaimed land away from cities, affect all kingdoms and do not count as another kingdom or alter victory conditions.</li>
    <li>Camps have ${CAMP_HP} HP. Attack them with troops, just like a target on a red hex. Clearing one pays ${CAMP_REWARD} gold and stops its reinforcements; existing raiders remain until defeated.</li>
    <li>Raiders are Swordsmen. They raid amenities, farms and roads and fight units, but never attack or capture cities. Camps send a raider every 10/7/5 rounds on Easy/Normal/Hard, with a warning round before a new raider moves. Camp and raider totals are capped.</li>
    <li>Barbarians require no declaration of war and cannot negotiate peace. Ordinary kingdom diplomacy is unchanged. With camps enabled, fog and troop recruitment also work in a one-kingdom game. Old saves without this feature keep barbarians off.</li></ul>`;
  body.prepend(section);
  for (const li of body.querySelectorAll('li')) {
    if (li.textContent === 'No fog in a sandbox game.') li.textContent = 'No fog in a sandbox with barbarian camps turned off.';
    if (li.textContent === 'Difficulty only changes the AI kingdoms.') li.textContent = 'Difficulty changes AI kingdoms and how often barbarian camps send raiders.';
  }
}
