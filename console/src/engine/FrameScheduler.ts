/**
 * FrameScheduler — Decouples physics (30Hz) from rendering (60Hz)
 *
 * Physics tick runs at fixed 30Hz intervals.
 * Rendering frames interpolate between physics frames using alpha factor.
 */

export class FrameScheduler {
  private physicsTick: () => void;
  private physicsInterval: number;
  private lastPhysicsTime = 0;
  private accumulator = 0;

  /**
   * @param physicsTick  Function to call each physics step
   * @param physicsHz    Physics update rate (default 30)
   */
  constructor(physicsTick: () => void, physicsHz = 30) {
    this.physicsTick = physicsTick;
    this.physicsInterval = 1000 / physicsHz;
  }

  /**
   * Called every render frame (requestAnimationFrame / useFrame).
   * Runs physics ticks as needed and returns interpolation alpha.
   *
   * @param now  Current timestamp in ms (performance.now() or clock.elapsedTime*1000)
   * @returns alpha [0,1] — interpolation factor between last and current physics frame
   */
  update(now: number): number {
    if (this.lastPhysicsTime === 0) {
      this.lastPhysicsTime = now;
      this.physicsTick();
      return 0;
    }

    this.accumulator += now - this.lastPhysicsTime;
    this.lastPhysicsTime = now;

    // Run physics ticks to catch up (max 3 to avoid spiral of death)
    let steps = 0;
    while (this.accumulator >= this.physicsInterval && steps < 3) {
      this.physicsTick();
      this.accumulator -= this.physicsInterval;
      steps++;
    }

    // Alpha: how far into the next physics step we are
    return Math.min(this.accumulator / this.physicsInterval, 1);
  }

  /** Reset timing (e.g. after tab becomes visible again) */
  reset() {
    this.lastPhysicsTime = 0;
    this.accumulator = 0;
  }
}
