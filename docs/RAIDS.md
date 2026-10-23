# Territory raids and barbarians

Amenities already occupy one non-Keep hex of their city's territory. This feature makes those locations military targets without replacing existing farms, roads or city decoration.

## Pillaging and repairs

The existing Pillage action (L) prioritizes the operational amenity on the troop's hex, then the existing improvement/road targets. Ordinary kingdoms must still declare war. Pillaging consumes the troop's action and movement.

A Market steals up to 8 gold from its kingdom's treasury, never below zero. Other amenities award 5 gold. The amenity remains built, occupies its slot and keeps its location and decorations. Its base effects, own placement bonuses, adjacency support, Mill/Harbor production, Barracks speed and required-unit unlocks stop until repaired. A damaged amenity cannot pay loot repeatedly; underlying farms/roads remain independently pillageable.

Repair from the map city's Repairs section, a selected owned territory hex, or the amenity/Keep panel inside City View. Pay 25% of original gold cost, rounded up with a 5g minimum, and use the city's shared project slot for two owner turns. Free building removes the cost, not the time. Enemy occupation blocks/pauses repairs. Capture cancels the old owner's repair; damage remains with the city.

## Barbarian camps

New-game checkbox, on by default. A one-kingdom game can have camps, fog and troop recruitment without kingdom wars or victory pressure. Legacy saves without the explicit setting retain camps off.

Camps spawn on hidden, unclaimed, unimproved land 7-12 hexes from a city, at least 8 apart. They cannot appear in any living kingdom's explored or currently visible territory. Initial and replenishment placement are deterministic for seed/round; failed placement is harmless. At most 8 camps and 16 roaming raiders exist. Another hidden camp is attempted every 12 rounds.

Camps have 20 HP, cannot move, attack, counterattack or cause a siege. Clearing one pays 15g once and stops its reinforcements. Surviving raiders do not vanish. Camps cannot be bought or swallowed by automatic border growth.

Raiding parties use normal Swordsman combat stats. Each camp attempts a new raider every 10/7/5 rounds on Easy/Normal/Hard, with at most two nearby and a full warning round before a new raider moves. Raiders prioritize amenities (especially Markets), then improvements/roads, and can fight units or break palisades. They do not attack/capture cities. All kingdoms may fight them without creating diplomatic wars. AI kingdoms defend with existing combat rules, can hunt visible nearby camps, and pay for repairs.

## Integration

raidState, amenityRaids, barbarians, raidRules, and raidSave are pure world modules. raidRules is an explicit, idempotent adapter around the existing engine. The two legacy lifecycle hooks (startTurn/runAI) have one typed compatibility boundary. No prototype adaptation is scattered through gameplay modules.

The hostile faction is a non-playing, inactive entry appended after normal capitals are placed. It has no capital, land, regular turn, economy, diplomacy or victory claim. Existing units/pathfinding/combat can therefore resolve its occupancy without inventing a fifth kingdom seat. Camps use stationary catapult-type occupancy proxies, identified by camp ID rather than troop type; the adapter suppresses their attack/counter/movement, and RaidUi renders/names them as camps. Roaming parties use Swordsmen. The HUD removes the compatibility faction from kingdom counts/table.

RaidUi/RaidMenu adapt the existing map, city and menu surfaces in one place. Camps have tent markers and HP bars; damaged amenities have red crosses on visible world hexes. The guide explains repairs, camp cadence and one-kingdom mode. No art dependency or paid generation.

## Saves and verification

The browser version remains 3 and city layout remains 2. The additive raids section stores camps/cadence, damage and repairs; normal unit storage preserves camp/raider positions and HP. Damaged buildings remain in existing building bits/sites, so layout migration never treats them as missing. Owner changes cancel stale repairs. Map dimensions and previous plot/decoration migration remain supported.

Run:

```sh
npm run build
node scripts/test-raids.mjs
node scripts/test-city-territory.mjs
node scripts/test-map-sizes.mjs
```

The new regression suite covers peace/war pillage, treasury limits, preserved town data, repeated-loot protection, repair cost/occupation/owner turns/capture, damaged adjacency, hidden camp placement, non-kingdom victory behavior, camp attacks/rewards, raid cadence/caps, city capture prevention, saves, legacy saves and three difficulty soak games.

Browser playtests are still required: menu checkbox, one-kingdom recruitment/fog, camp visibility and attack selection, phone input, city/map repair controls, damaged amenity visuals, captured cities and an existing save. Syntax checks alone do not prove the full build, gameplay balance or browser rendering.
