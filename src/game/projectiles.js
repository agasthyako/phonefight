// Projectiles: flight, contact with the Sword, and how each contact is Resolved.
//
// A contact is a Slice when an Edge meets the Projectile while moving above SLICE_SPEED;
// every other contact (the Flat, or an Edge moving too slowly) is a Deflect.

import {
  Color, ConeGeometry, CylinderGeometry, DoubleSide, IcosahedronGeometry, Mesh, MeshStandardMaterial, Plane,
  Quaternion, Vector3, Matrix4,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { closestSegmentSegment, coloured, splitGeometry } from "./geom.js";
import { BLADE_HALF_WIDTH } from "./sword.js";

/** Blade speed at the contact point, m/s, above which an Edge Slices. About 300 deg/s mid-blade. */
export const SLICE_SPEED = 3.2;
const GRAVITY = new Vector3(0, -9.8, 0);
const SUBSTEPS = 10;
/** Projectiles that reach this depth have reached the player. */
const PLAYER_PLANE_Z = -0.15;
const DEBRIS_LIFE = 2.5;

const UP = new Vector3(0, 1, 0);
const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, side: DoubleSide });

/** Every kind is a capsule along its local Y axis for collisions. */
export const KINDS = {
  arrow: {
    radius: 0.05, halfLength: 0.38, gravity: 0.35, aligned: true, convex: false,
    inner: new Color(0xd9b98c), glow: 0xd9b98c,
    build() {
      const shaft = coloured(new CylinderGeometry(0.012, 0.012, 0.72, 5), new Color(0x8a5a33));
      const head = coloured(new ConeGeometry(0.03, 0.1, 5).translate(0, 0.41, 0), new Color(0xb8c2cc));
      const fletch = coloured(new ConeGeometry(0.035, 0.14, 3).translate(0, -0.3, 0), new Color(0xe8e0d0));
      return mergeGeometries([shaft, head, fletch]);
    },
  },
  melon: {
    radius: 0.17, halfLength: 0, gravity: 0.45, convex: true,
    inner: new Color(0xff4a5a), glow: 0xff6b7a,
    build: () => coloured(new IcosahedronGeometry(0.17, 1).scale(1, 1.15, 1), new Color(0x2f8a3a)),
  },
  pot: {
    radius: 0.15, halfLength: 0.06, gravity: 0.45, convex: true,
    inner: new Color(0x5a2a18), glow: 0xffa060,
    build: () => coloured(new CylinderGeometry(0.1, 0.15, 0.3, 9), new Color(0xc0643a)),
  },
  log: {
    radius: 0.09, halfLength: 0.24, gravity: 0.45, convex: true,
    inner: new Color(0xe8c88a), glow: 0xe8c88a,
    build: () => coloured(new CylinderGeometry(0.09, 0.09, 0.56, 8), new Color(0x5c3b22)),
  },
};

export class Projectiles {
  /**
   * @param {object} hooks onDeflect(p, at, away) / onSlice(p, at) / onHitPlayer(p) / onMiss(p)
   */
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.flying = [];
    this.debris = [];
  }

  /** Launch a Projectile of `kind` from `from` so it would arrive at `to` after `flightTime` seconds. */
  launch(kind, from, to, flightTime) {
    const k = KINDS[kind];
    const g = GRAVITY.clone().multiplyScalar(k.gravity);
    const vel = new Vector3().subVectors(to, from).divideScalar(flightTime).addScaledVector(g, -0.5 * flightTime);
    const mesh = new Mesh(k.build(), material);
    mesh.position.copy(from);
    const spin = k.aligned ? new Vector3() : new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
    const p = { kind, k, mesh, vel, spin, gravity: g };
    this._orient(p, 0);
    this.scene.add(mesh);
    this.flying.push(p);
    return p;
  }

  get count() {
    return this.flying.length;
  }

  clear() {
    for (const p of [...this.flying, ...this.debris]) this._dispose(p.mesh);
    this.flying.length = 0;
    this.debris.length = 0;
  }

  /** Advance by dt, colliding against the Sword's motion over the same interval. */
  update(dt, sword) {
    const blade = {};
    const cA = new Vector3(), cB = new Vector3();
    const segA = new Vector3(), segB = new Vector3();

    for (let step = 1; step <= SUBSTEPS; step++) {
      const h = dt / SUBSTEPS;
      if (sword) sword.bladeAt(step / SUBSTEPS, blade);
      for (let i = this.flying.length - 1; i >= 0; i--) {
        const p = this.flying[i];
        p.vel.addScaledVector(p.gravity, h);
        p.mesh.position.addScaledVector(p.vel, h);
        this._orient(p, h);

        if (sword) {
          this._segment(p, segA, segB);
          const reach = p.k.radius + BLADE_HALF_WIDTH;
          if (closestSegmentSegment(segA, segB, blade.base, blade.tip, cA, cB) < reach * reach) {
            this.flying.splice(i, 1);
            this._resolve(p, sword, blade, cB);
            continue;
          }
        }

        const pos = p.mesh.position;
        if (pos.z > PLAYER_PLANE_Z) {
          this.flying.splice(i, 1);
          const onBody = Math.abs(pos.x) < 0.4 && pos.y > 0.8 && pos.y < 2.0;
          this._dispose(p.mesh);
          if (onBody) this.hooks.onHitPlayer?.(p);
          else this.hooks.onMiss?.(p);
        } else if (pos.y < -0.5) {
          this.flying.splice(i, 1);
          this._dispose(p.mesh);
          this.hooks.onMiss?.(p);
        }
      }
    }

    this.debris = this.debris.filter((d) => {
      d.age += dt;
      d.vel.addScaledVector(GRAVITY, dt);
      d.mesh.position.addScaledVector(d.vel, dt);
      spinBy(d.mesh.quaternion, d.spin, dt);
      if (d.mesh.position.y < 0.05 && d.vel.y < 0) {
        d.mesh.position.y = 0.05;
        d.vel.y *= -0.3;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
      if (d.age > DEBRIS_LIFE) {
        this._dispose(d.mesh);
        return false;
      }
      d.mesh.scale.setScalar(Math.min(1, (DEBRIS_LIFE - d.age) / 0.4));
      return true;
    });
  }

  _segment(p, a, b) {
    const axis = UP.clone().applyQuaternion(p.mesh.quaternion).multiplyScalar(p.k.halfLength);
    a.copy(p.mesh.position).sub(axis);
    b.copy(p.mesh.position).add(axis);
  }

  _orient(p, dt) {
    if (p.k.aligned) p.mesh.quaternion.setFromUnitVectors(UP, p.vel.clone().normalize());
    else spinBy(p.mesh.quaternion, p.spin, dt);
  }

  _resolve(p, sword, blade, at) {
    const bladeVel = sword.pointVelocity(at, blade);
    const rel = p.vel.clone().sub(bladeVel);
    const onEdge = Math.abs(rel.dot(blade.edge)) > Math.abs(rel.dot(blade.flatNormal));

    if (onEdge && bladeVel.length() > SLICE_SPEED) this._slice(p, blade, bladeVel, at);
    else this._deflect(p, blade, bladeVel, rel, onEdge ? blade.edge : blade.flatNormal, at);
  }

  _deflect(p, blade, bladeVel, rel, normal, at) {
    // Which side of the blade the Projectile is on decides which way it's pushed.
    const side = new Vector3().subVectors(p.mesh.position, at);
    const n = normal.clone();
    if (side.dot(n) < 0) n.negate();
    const vn = rel.dot(n);
    const reflected = rel.clone().addScaledVector(n, -(1 + 0.55) * Math.min(vn, 0));
    const vel = reflected.add(bladeVel);
    if (vel.dot(n) < 1) vel.addScaledVector(n, 1 - vel.dot(n)); // always leave the blade
    p.mesh.position.addScaledVector(n, 0.03);
    const spin = new Vector3().crossVectors(n, bladeVel).multiplyScalar(4)
      .add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(10));
    this.debris.push({ mesh: p.mesh, vel, spin, age: 0 });
    this.hooks.onDeflect?.(p, at, n);
  }

  _slice(p, blade, bladeVel, at) {
    // The swing plane: containing the blade and the direction it's moving.
    const normal = new Vector3().crossVectors(blade.axis, bladeVel);
    if (normal.lengthSq() < 1e-8) normal.copy(blade.flatNormal);
    normal.normalize();

    const mesh = p.mesh;
    mesh.updateMatrixWorld();
    const toLocal = new Matrix4().copy(mesh.matrixWorld).invert();
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, at).applyMatrix4(toLocal);
    const halves = splitGeometry(mesh.geometry, plane, p.k.inner, p.k.convex);
    if (!halves) {
      // The Edge only grazed it: count it as a Deflect so the player still gets their save.
      this._deflect(p, blade, bladeVel, p.vel.clone().sub(bladeVel), blade.edge, at);
      return;
    }

    const spread = Math.max(1.5, bladeVel.length() * 0.25);
    halves.forEach((geo, i) => {
      geo.computeBoundingSphere();
      const centre = geo.boundingSphere.center.clone();
      geo.translate(-centre.x, -centre.y, -centre.z);
      const piece = new Mesh(geo, material);
      piece.quaternion.copy(mesh.quaternion);
      piece.position.copy(centre).applyMatrix4(mesh.matrixWorld);
      this.scene.add(piece);
      const sign = i === 0 ? 1 : -1;
      const vel = p.vel.clone().multiplyScalar(0.35)
        .addScaledVector(bladeVel, 0.35)
        .addScaledVector(normal, sign * spread);
      const spin = new Vector3().crossVectors(normal, bladeVel).normalize().multiplyScalar(sign * 9)
        .add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4));
      this.debris.push({ mesh: piece, vel, spin, age: 0 });
    });
    this._dispose(mesh);
    this.hooks.onSlice?.(p, at, normal);
  }

  _dispose(mesh) {
    this.scene.remove(mesh);
    mesh.geometry.dispose();
  }
}

function spinBy(q, spin, dt) {
  const angle = spin.length() * dt;
  if (angle < 1e-6) return;
  q.premultiply(new Quaternion().setFromAxisAngle(spin.clone().normalize(), angle)).normalize();
}
