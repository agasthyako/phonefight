// Drives the Sword in attract mode, so portfolio visitors without a phone see the game playing itself.
// It picks the nearest incoming Projectile, cocks the blade to one side, then swings Edge-first through it.

import { Matrix4, Quaternion, Vector3 } from "three";

const SWING_RATE = (900 * Math.PI) / 180;
const COCK = (75 * Math.PI) / 180;
const IDLE = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2 + 0.5);

export class Bot {
  constructor() {
    this.q = IDLE.clone();
    this.target = null;
    this.theta = -COCK;
    this.swinging = false;
    this.axis = new Vector3(0, 1, 0);
    this.time = 0;
  }

  /** Returns the phone-frame -> world rotation for this frame. */
  update(dt, sword, projectiles) {
    this.time += dt;
    const hand = sword.cur.hand;

    if (!this.target || !projectiles.flying.includes(this.target)) {
      this.target = null;
      this.swinging = false;
      let best = Infinity;
      for (const p of projectiles.flying) {
        const d = p.mesh.position.distanceTo(hand);
        if (p.mesh.position.z < -0.4 && d < 7 && d < best) { best = d; this.target = p; }
      }
      if (this.target) {
        // A random swing direction, roughly across the line of sight.
        const toward = this.target.mesh.position.clone().sub(hand).normalize();
        const a = Math.random() * Math.PI;
        this.axis.set(Math.cos(a), Math.sin(a), 0).projectOnPlane(toward).normalize();
        this.theta = -COCK;
      }
    }

    let goal;
    if (this.target) {
      const p = this.target.mesh.position;
      const toward = p.clone().sub(hand).normalize();
      const dist = p.distanceTo(hand);
      if (!this.swinging && dist < 1.25 + this.target.vel.length() * 0.06) this.swinging = true;
      if (this.swinging) this.theta = Math.min(COCK, this.theta + SWING_RATE * dt);
      goal = bladePose(toward, this.axis, this.theta);
    } else {
      goal = IDLE.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.sin(this.time) * 0.2));
    }
    const rate = this.swinging ? 1 : 1 - Math.exp(-dt * 10);
    this.q.slerp(goal, rate);
    return this.q.clone();
  }
}

/** Blade pointing along `toward` rotated by theta about `axis`, with the leading Edge facing the motion. */
function bladePose(toward, axis, theta) {
  const along = toward.clone().applyAxisAngle(axis, theta);
  const edge = new Vector3().crossVectors(axis, along).normalize();
  const flat = new Vector3().crossVectors(edge, along).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(edge, along, flat));
}
