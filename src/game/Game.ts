import BackgroundScene from "./BackgroundScene";

export default class Game extends Phaser.Game {
  constructor(
    container: HTMLElement | HTMLCanvasElement,
    config: Phaser.Types.Core.GameConfig = {}
  ) {
    super({
      ...config,
      parent: container,
      backgroundColor: "#000",
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [BackgroundScene],
    });
  }
}
