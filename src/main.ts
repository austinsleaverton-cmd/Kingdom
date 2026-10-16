import Phaser from 'phaser';
import { MapScene } from './scenes/MapScene';
import { CityScene } from './scenes/CityScene';
import { attachCityScreen } from './scenes/CityView';
import { installHelp } from './scenes/Help';

// The test build at /dev/ (built with VITE_CHANNEL=dev) says so in the tab / app switcher
if (import.meta.env.VITE_CHANNEL === 'dev') document.title = `${document.title} (dev)`;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0b1a2e',
  antialias: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // The map starts; the city screen sleeps until you open a city
  scene: [MapScene, CityScene],
};

export const game = new Phaser.Game(config);
attachCityScreen(game); // lets the City View switch between the map and the city screen
installHelp(); // the "?" button and rules guide

// iOS can leave the page scrolled or the canvas mis-sized after rotating, so taps land in the
// wrong place. Snap back to the top and re-measure whenever the screen size changes.
const fixViewport = () => {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  game.scale.refresh();
};
window.addEventListener('resize', fixViewport);
window.visualViewport?.addEventListener('resize', fixViewport);
window.addEventListener('orientationchange', () => {
  fixViewport();
  window.setTimeout(fixViewport, 350); // iOS reports the new size a moment late
});

// Installable app + offline play (only on the built site, not the dev server)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // no offline support, the game still works
    });
  });
}
