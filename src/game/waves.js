// Plans and runs Waves: which Launcher throws what, when, and how fast.

import { Vector3 } from "three";
import { placeLaunchers } from "./arena.js";

const WINDUP = 0.7; // Launchers glow this long before they launch, so every Projectile is telegraphed
const THROWN = ["melon", "pot", "log"];

export class WaveDirector {
  constructor(scene, projectiles) {
    this.scene = scene;
    this.projectiles = projectiles;
    this.launchers = [];
    this.number = 0;
    this.schedule = [];
    this.clock = 0;
  }

  /** Start Wave `n` (1-based). */
  start(n) {
    this.number = n;
    this.clock = 0;
    const want = Math.min(7, 3 + Math.floor(n / 2));
    if (this.launchers.length !== want) {
      for (const l of this.launchers) l.dispose(this.scene);
      this.launchers = placeLaunchers(this.scene, want);
    }
    this.schedule = plan(n, this.launchers);
  }

  /** Everything launched and nothing still in the air. */
  get done() {
    return this.schedule.length === 0 && this.projectiles.count === 0;
  }

  update(dt) {
    this.clock += dt;
    for (const l of this.launchers) l.update(dt);
    for (let i = this.schedule.length - 1; i >= 0; i--) {
      const s = this.schedule[i];
      const until = s.at - this.clock;
      if (until <= WINDUP) s.launcher.windup = Math.max(s.launcher.windup, 1 - until / WINDUP);
      if (until <= 0) {
        this.schedule.splice(i, 1);
        this.projectiles.launch(s.kind, s.launcher.muzzle, s.target, s.flightTime);
      }
    }
  }

  clear() {
    this.schedule = [];
  }
}

function plan(n, launchers) {
  const count = 3 + 2 * n;
  const arrowShare = Math.min(0.7, 0.3 + 0.08 * n);
  const gap = Math.max(0.45, 1.5 - 0.12 * n);
  const archers = launchers.filter((l) => l.kind === "archer");
  const throwers = launchers.filter((l) => l.kind === "thrower");
  const out = [];
  let at = 1.0;
  for (let i = 0; i < count; i++) {
    const arrow = Math.random() < arrowShare;
    const pool = arrow ? archers : throwers;
    const launcher = pool[Math.floor(Math.random() * pool.length)];
    const flightTime = arrow ? Math.max(0.75, 1.5 - 0.07 * n) : Math.max(1.1, 1.9 - 0.07 * n);
    // Aim at the head and chest, a little wider each Wave.
    const spread = Math.min(0.35, 0.15 + 0.03 * n);
    const target = new Vector3((Math.random() * 2 - 1) * spread, 1.2 + Math.random() * 0.5, 0);
    out.push({ at, launcher, kind: arrow ? "arrow" : THROWN[Math.floor(Math.random() * THROWN.length)], target, flightTime });
    // Later Waves sometimes launch two at once.
    const double = n >= 3 && Math.random() < Math.min(0.35, 0.08 * n);
    at += double ? 0.05 : gap * (0.7 + Math.random() * 0.6);
  }
  return out;
}
