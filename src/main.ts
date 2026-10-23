import Phaser from 'phaser';
import { MapScene } from './scenes/MapScene';
import { CityScene } from './scenes/CityScene';
import { attachCityScreen } from './scenes/CityView';
import { installHelp } from './scenes/Help';
import { installRaidRules } from './world/raidRules';
import { installRaidUi } from './scenes/RaidUi';
import { installRaidGuide } from './scenes/RaidGuide';
installRaidRules();
installRaidUi();
if (import.meta.env.VITE_CHANNEL === 'dev') document.title = `${document.title} (dev)`;
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, parent: 'game', width: window.innerWidth, height: window.innerHeight,
  backgroundColor: '#0b1a2e', antialias: true,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [MapScene, CityScene],
};
export const game = new Phaser.Game(config);
attachCityScreen(game);
installHelp();
installRaidGuide();
const fixViewport = () => {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  game.scale.refresh();
};
window.addEventListener('resize', fixViewport);
window.visualViewport?.addEventListener('resize', fixViewport);
window.addEventListener('orientationchange', () => { fixViewport(); window.setTimeout(fixViewport, 350); });
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
