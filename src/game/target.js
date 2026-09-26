// A floating orb the player strikes with the Sword to trigger something (Restart), so nobody has to reach for a keyboard.

import {
  CanvasTexture, IcosahedronGeometry, Mesh, MeshStandardMaterial, Sprite, SpriteMaterial, Vector3,
} from "three";
import { closestSegmentSegment } from "./geom.js";
import { BLADE_HALF_WIDTH } from "./sword.js";

const RADIUS = 0.15;
const ARM_AFTER = 1.0; // seconds before it can be struck, so a swing already in progress doesn't trigger it
const MIN_SWING = 150; // deg/s: resting the blade against it doesn't count

export class SwordTarget {
  constructor(scene, label, position, onStruck) {
    this.scene = scene;
    this.home = position.clone();
    this.onStruck = onStruck;
    this.time = 0;
    this.orb = new Mesh(
      new IcosahedronGeometry(RADIUS, 1),
      new MeshStandardMaterial({ color: 0xffb547, emissive: 0xffb547, emissiveIntensity: 1.2, flatShading: true }),
    );
    this.label = new Sprite(new SpriteMaterial({ map: labelTexture(label), transparent: true, depthWrite: false }));
    this.label.scale.set(0.6, 0.15, 1);
    scene.add(this.orb, this.label);
    this.update(0, null);
  }

  update(dt, sword) {
    this.time += dt;
    this.orb.position.copy(this.home).add(new Vector3(0, Math.sin(this.time * 2) * 0.05, 0));
    this.orb.rotation.y += dt;
    this.label.position.copy(this.orb.position).add(new Vector3(0, -0.26, 0));
    if (!sword || this.time < ARM_AFTER || sword.swingSpeed < MIN_SWING) return false;
    const blade = {}, a = new Vector3(), b = new Vector3();
    const reach = RADIUS + BLADE_HALF_WIDTH;
    for (let s = 1; s <= 6; s++) {
      sword.bladeAt(s / 6, blade);
      if (closestSegmentSegment(blade.base, blade.tip, this.orb.position, this.orb.position, a, b) < reach * reach) {
        this.onStruck(this.orb.position.clone());
        return true;
      }
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.orb, this.label);
  }
}

function labelTexture(text) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.font = "700 64px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ffe8c2";
  g.shadowColor = "rgba(0,0,0,0.6)";
  g.shadowBlur = 12;
  g.fillText(text, 256, 64);
  return new CanvasTexture(c);
}
