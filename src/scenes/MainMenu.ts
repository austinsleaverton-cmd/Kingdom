import { Scene } from "phaser";

export default class MainMenu extends Scene {
  constructor() {
    super("MainMenu");
  }

  create(): void {
    this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x0b0b12
    );
  }
}
