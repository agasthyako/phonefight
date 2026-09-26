// Sparks and flashes. Pooled, additive, cheap.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Mesh, MeshBasicMaterial, PlaneGeometry, Points,
  PointsMaterial, Vector3,
} from "three";

const MAX_SPARKS = 400;

export class Fx {
  constructor(scene, camera) {
    this.camera = camera;
    this.sparks = [];
    this.geo = new BufferGeometry();
    this.pos = new BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
    this.col = new BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
    this.geo.setAttribute("position", this.pos);
    this.geo.setAttribute("color", this.col);
    this.glow = glowTexture();
    const points = new Points(this.geo, new PointsMaterial({
      size: 0.08, map: this.glow, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false,
    }));
    points.frustumCulled = false;
    scene.add(points);

    this.flashes = [];
    this.flashGeo = new PlaneGeometry(1, 1);
    this.scene = scene;
  }

  spray(at, dir, count, color, speed = 5) {
    const c = new Color(color);
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const v = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        .multiplyScalar(speed * (0.3 + Math.random()));
      if (dir) v.addScaledVector(dir, speed * 0.6);
      this.sparks.push({ p: at.clone(), v, life: 0.25 + Math.random() * 0.35, age: 0, c });
    }
  }

  /** A metallic clang: orange sparks sprayed away from the blade. */
  deflect(at, away) {
    this.spray(at, away, 26, 0xffc36b, 5);
    this.flash(at, 0xffd49a, 0.5, 0.12);
  }

  /** A clean cut: a bright streak along the cut plane and pale sparks. */
  slice(at, color) {
    this.spray(at, null, 18, 0xe8fbff, 3.5);
    this.spray(at, null, 14, color, 2.5);
    this.flash(at, 0xc8f4ff, 0.9, 0.16);
  }

  burst(at, color) {
    this.spray(at, null, 60, color, 4);
    this.flash(at, color, 1.4, 0.3);
  }

  flash(at, color, size, life) {
    const m = new Mesh(this.flashGeo, new MeshBasicMaterial({
      color, map: this.glow, transparent: true, blending: AdditiveBlending, depthWrite: false,
    }));
    m.position.copy(at);
    this.scene.add(m);
    this.flashes.push({ m, size, life, age: 0 });
  }

  update(dt) {
    let n = 0;
    this.sparks = this.sparks.filter((s) => (s.age += dt) < s.life);
    for (const s of this.sparks) {
      s.v.y -= 9.8 * dt;
      s.p.addScaledVector(s.v, dt);
      const k = 1 - s.age / s.life;
      this.pos.setXYZ(n, s.p.x, s.p.y, s.p.z);
      this.col.setXYZ(n, s.c.r * k, s.c.g * k, s.c.b * k);
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;

    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        this.scene.remove(f.m);
        f.m.material.dispose();
        return false;
      }
      f.m.quaternion.copy(this.camera.quaternion);
      f.m.scale.setScalar(f.size * (0.4 + k));
      f.m.material.opacity = 1 - k;
      return true;
    });
  }
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
