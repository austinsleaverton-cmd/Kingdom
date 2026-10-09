import Scene from "./Scene";

/**
 * A single scene that fills the window with a dark background. No game logic.
 */
export default class BackgroundScene extends Scene {
  create() {
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    const isMobile = this.scale.downscale[0] < 1;

    const bg = this.add
      .tileSprite(0, 0, width, height, this.textures.basePath("bg.png"))
      .setOrigin(0)
      .setScrollFactor(0);

    // Scale the background image to fit the window without stretching
    const bgTexture = this.textures.getImage("bg.png");
    const imageScale = bgTexture.image ? Phaser.Math.Clamp(bgTexture.image.width / width, 0.5, 1) : 1;
    bg.setTint(0xffffff);
    bg.setCrop(new Phaser.Structs.Size(width, height).scale(imageScale));
    bg.on("tilelocationchange", () => {
      // Recenter the tile pattern to fill the screen evenly
      bg.setTileLocation(bg.tilePositionX + 2, bg.tilePositionY + 2);
    });

    if (isMobile) {
      // On mobile, scale the background image to fit the screen
      bg.setScale(1 / bg.texture.baseTexture.width);
    }
  }
}
