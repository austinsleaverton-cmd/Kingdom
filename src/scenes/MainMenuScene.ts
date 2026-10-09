import Phaser from "phaser";

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MainMenuScene" });
  }

  create(): void {
    // Fills the window with a dark background (Phaser Scale.RESIZE
    // keeps the scene canvas sized to the browser window).
    this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x0f0f0f);
  }
}
