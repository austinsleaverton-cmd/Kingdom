export class Main extends Phaser.Scene {
  constructor() {
    super('Main');
  }

  override create(): void {
    // Dark background that fills the window.
    this.cameras.main.setBackgroundColor('#181818');
  }
}
