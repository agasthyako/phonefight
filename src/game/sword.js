// The Sword: posed from a phone-frame -> world rotation through an arm model, plus the
// kinematics (blade pose between frames, point velocities) that collisions need.
//
// The phone is the grip: its +Y (top) runs along the blade, its +Z (screen normal) is the
// Flat's normal, and its ±X (long narrow sides) are the two Edges.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CylinderGeometry, BoxGeometry, DoubleSide, Group,
  Mesh, MeshStandardMaterial, MeshBasicMaterial, Quaternion, Vector3, Color,
} from "three";

export const BLADE_BASE = 0.1; // from the hand to where the blade starts
export const BLADE_TIP = 1.12; // from the hand to the tip
export const BLADE_HALF_WIDTH = 0.035;

const UP_Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);

const HEAD = new Vector3(0, 1.6, 0);
const FORWARD = new Vector3(0, 0, -1);
/** How much of the blade's rotation the arm takes; the wrist takes the rest. */
const ARM_SHARE = 0.35;
const ARM_REACH = 0.45;
/** Raising the blade raises the hand (and pushes it out a little), so the Sword doesn't just pivot in place. */
const LIFT_UP = 0.25, LIFT_DOWN = 0.12, LIFT_OUT = 0.1;
// The high guard, as in Red Steel 2: hold the blade level across the body, still, and the hand rises to just
// above eye level. Only orientation is known, so a still, level, sideways blade is what reads as "raised".
// Swinging drops out of it at once, so horizontal slashes stay at the arm model's height.
const GUARD_HAND = new Vector3(0.3, 1.68, -0.3); // x goes to the side opposite the tip, so the blade covers the middle
const GUARD_STILL = 120; // deg/s: slower than this counts as holding the guard
const GUARD_RISE = 8, GUARD_DROP = 25; // 1/s

class Pose {
  constructor() {
    this.hand = new Vector3();
    this.q = new Quaternion();
  }
  copy(o) { this.hand.copy(o.hand); this.q.copy(o.q); return this; }
}

export class Sword {
  constructor(scene) {
    this.handedness = "right";
    this.prev = new Pose();
    this.cur = new Pose();
    this.omega = new Vector3(); // world angular velocity, rad/s
    this.handVel = new Vector3();
    this._fresh = true;
    this.guard = 0; // 0..1: how far into the high guard

    this.mesh = buildMesh();
    scene.add(this.mesh);
    this.trail = new Trail(scene);
  }

  get shoulder() {
    return HEAD.clone().add(new Vector3(this.handedness === "left" ? -0.16 : 0.16, -0.35, 0.05));
  }

  /** Swing speed in deg/s. */
  get swingSpeed() {
    return (this.omega.length() * 180) / Math.PI;
  }

  /**
   * Move to a new pose. `q` rotates phone frame into the world; `omega` is the world angular
   * velocity if the source measured it (gyroscope), otherwise it's derived from the pose change.
   */
  update(q, omega, dt) {
    this.prev.copy(this.cur);
    this.cur.q.copy(q);
    if (this._fresh) this.prev.q.copy(q);
    if (omega) this.omega.copy(omega);
    else if (dt > 0) this.omega.copy(angularVelocity(this.prev.q, this.cur.q, dt));

    this._updateGuard(q, dt);
    this.cur.hand.copy(this._armModel(q));
    if (this._fresh) { this.prev.hand.copy(this.cur.hand); this._fresh = false; }
    this.handVel.subVectors(this.cur.hand, this.prev.hand).divideScalar(Math.max(dt, 1e-3));

    this.mesh.position.copy(this.cur.hand);
    this.mesh.quaternion.copy(this.cur.q);
    this.trail.push(this, this.swingSpeed);
  }

  /** Snap without leaving a trail or a velocity (after pausing, recentring...). */
  reset() {
    this._fresh = true;
    this.guard = 0;
    this.trail.clear();
  }

  _updateGuard(q, dt) {
    const along = UP_Y.clone().applyQuaternion(q);
    const still = 1 - smoothstep(GUARD_STILL, GUARD_STILL * 2.5, this.swingSpeed);
    const target = smoothstep(0.6, 0.85, along.x * along.x) * still;
    const rate = target > this.guard ? GUARD_RISE : GUARD_DROP;
    this.guard += (target - this.guard) * (1 - Math.exp(-rate * dt));
  }

  _armModel(q) {
    const along = UP_Y.clone().applyQuaternion(q);
    const full = new Quaternion().setFromUnitVectors(FORWARD, along);
    const arm = new Quaternion().slerp(full, ARM_SHARE);
    const hand = this.shoulder.addScaledVector(FORWARD.clone().applyQuaternion(arm), ARM_REACH);
    hand.y += along.y * (along.y > 0 ? LIFT_UP : LIFT_DOWN);
    hand.z -= Math.max(0, along.y) * LIFT_OUT;
    if (this.guard > 0) {
      const guard = GUARD_HAND.clone().setX(-Math.sign(along.x) * GUARD_HAND.x);
      hand.lerp(guard, this.guard);
    }
    return hand;
  }

  /** The blade at fraction `t` of the way from the previous pose to the current one. */
  bladeAt(t, out = {}) {
    const q = (out.q ||= new Quaternion()).slerpQuaternions(this.prev.q, this.cur.q, t);
    const hand = (out.hand ||= new Vector3()).lerpVectors(this.prev.hand, this.cur.hand, t);
    const axis = (out.axis ||= new Vector3()).copy(UP_Y).applyQuaternion(q);
    (out.flatNormal ||= new Vector3()).copy(Z).applyQuaternion(q);
    (out.edge ||= new Vector3()).copy(X).applyQuaternion(q);
    (out.base ||= new Vector3()).copy(hand).addScaledVector(axis, BLADE_BASE);
    (out.tip ||= new Vector3()).copy(hand).addScaledVector(axis, BLADE_TIP);
    return out;
  }

  /** World velocity of a point on the blade. */
  pointVelocity(point, blade) {
    const r = new Vector3().subVectors(point, blade.hand);
    return new Vector3().crossVectors(this.omega, r).add(this.handVel);
  }

  setVisible(v) {
    this.mesh.visible = v;
    this.trail.mesh.visible = v;
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Angular velocity (world, rad/s) that turns a into b over dt. */
export function angularVelocity(a, b, dt) {
  const dq = b.clone().multiply(a.clone().invert());
  if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
  const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
  if (s < 1e-6 || dt <= 0) return new Vector3();
  const angle = 2 * Math.acos(Math.min(1, dq.w));
  return new Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
}

function buildMesh() {
  const g = new Group();
  const steel = new MeshStandardMaterial({
    color: 0xdff6ff, emissive: 0x7fe3ff, emissiveIntensity: 0.08, metalness: 0.5, roughness: 0.45, flatShading: true, side: DoubleSide,
  });
  const blade = new Mesh(bladeGeometry(), steel);
  const grip = new Mesh(
    new CylinderGeometry(0.018, 0.02, 0.2, 8).translate(0, -0.02, 0),
    new MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.9 }),
  );
  const guard = new Mesh(
    new BoxGeometry(0.16, 0.025, 0.04).translate(0, BLADE_BASE - 0.01, 0),
    new MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 }),
  );
  g.add(blade, grip, guard);
  return g;
}

/** A diamond cross-section: Edges at ±X, Flats facing ±Z, tapering to a point. */
function bladeGeometry() {
  const w = BLADE_HALF_WIDTH, t = 0.008;
  const y0 = BLADE_BASE, y1 = BLADE_TIP - 0.14, y2 = BLADE_TIP;
  const ring = (y, s) => [[-w * s, y, 0], [0, y, t * s], [w * s, y, 0], [0, y, -t * s]];
  const a = ring(y0, 1), b = ring(y1, 1), tip = [0, y2, 0];
  const tris = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tris.push(a[i], b[i], b[j], a[i], b[j], a[j], b[i], tip, b[j]);
  }
  tris.push(a[0], a[2], a[1], a[0], a[3], a[2]);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(tris.flat()), 3));
  geo.computeVertexNormals();
  return geo;
}

/** A fading ribbon behind the blade, brighter the faster the swing. */
class Trail {
  static SAMPLES = 40;
  static PER_FRAME = 4; // interpolated sub-samples so fast swings draw arcs, not polygons

  constructor(scene) {
    const n = Trail.SAMPLES;
    this.points = []; // [{base, tip, glow}]
    this.geo = new BufferGeometry();
    this.pos = new BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.col = new BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.geo.setAttribute("position", this.pos);
    this.geo.setAttribute("color", this.col);
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      index.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(index);
    this.mesh = new Mesh(this.geo, new MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.color = new Color(0x7fe3ff);
    scene.add(this.mesh);
  }

  clear() { this.points.length = 0; }

  push(sword, speed) {
    const glow = 0.4 * Math.min(1, Math.max(0, (speed - 120) / 500));
    const blade = {};
    for (let i = 1; i <= Trail.PER_FRAME; i++) {
      sword.bladeAt(i / Trail.PER_FRAME, blade);
      this.points.unshift({ base: blade.hand.clone().addScaledVector(blade.axis, 0.35), tip: blade.tip.clone(), glow });
    }
    this.points.length = Math.min(this.points.length, Trail.SAMPLES);
    this._write();
  }

  _write() {
    const n = Trail.SAMPLES;
    const last = this.points[this.points.length - 1];
    for (let i = 0; i < n; i++) {
      const p = this.points[i] || last;
      const fade = p ? (1 - i / n) ** 1.6 * p.glow : 0;
      if (p) {
        this.pos.setXYZ(i * 2, p.base.x, p.base.y, p.base.z);
        this.pos.setXYZ(i * 2 + 1, p.tip.x, p.tip.y, p.tip.z);
      }
      const c = this.color;
      this.col.setXYZ(i * 2, c.r * fade * 0.25, c.g * fade * 0.25, c.b * fade * 0.25);
      this.col.setXYZ(i * 2 + 1, c.r * fade, c.g * fade, c.b * fade);
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}
