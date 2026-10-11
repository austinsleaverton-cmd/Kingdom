import Phaser from 'phaser';
import { MapScene } from './scenes/MapScene';

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
  scene: [MapScene],
};

export const game = new Phaser.Game(config);

// Installable app + offline play (only on the built site, not the dev server)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // no offline support, the game still works
    });
  });
}
