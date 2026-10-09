/**
 * Base class for all game scenes, providing a placeholder for shared functionality.
 * Extend this class to add logic to your own scenes.
 */
export default class Scene extends Phaser.Scene {
  constructor(config: Phaser.Types.Scene.SceneConfig = { key: "base" }) {
    super(config);
  }

  /**
   * Override this in your own scene to set up shared functionality (e.g. camera, UI).
   */
  create() {}

  /**
   * Override this in your own scene to clean up shared resources (e.g. listeners).
   */
  shutdown() {}
}
