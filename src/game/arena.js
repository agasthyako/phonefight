// The Arena: a stationary first-person grass field at sunset, with Launchers standing in view.

import {
  CapsuleGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3, BoxGeometry, MeshBasicMaterial,
  BackSide, BufferAttribute, BufferGeometry, DoubleSide, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion,
} from "three";

export const PLAYER_HEAD = new Vector3(0, 1.6, 0);
/** Launchers stand within this angle either side of straight ahead, so every Projectile's origin is on screen. */
const ARC = (32 * Math.PI) / 180;

export function buildArena(scene) {
  const haze = new Color(0xb4506a);
  scene.background = haze;
  scene.fog = new Fog(haze, 14, 42);
  scene.add(buildSky());

  scene.add(new HemisphereLight(0xffa6b8, 0x2a1830, 2.0));
  const sun = new DirectionalLight(0xffb27a, 2.4);
  sun.position.set(-8, 4, -10);
  scene.add(sun);

  const ground = new Mesh(new PlaneGeometry(120, 120), new MeshLambertMaterial({ color: 0x2c3a1e }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.add(buildGrass());

  // The setting sun, off to the left so its glare stays clear of the Launchers.
  const disc = new Mesh(new SphereGeometry(5, 10, 6), new MeshBasicMaterial({ color: 0xffc27a, fog: false }));
  disc.position.set(-52, 6, -70);
  scene.add(disc);

  // A torii gate behind the Launchers.
  const red = new MeshStandardMaterial({ color: 0x8e1b2c, roughness: 0.7 });
  const gate = new Group();
  for (const x of [-4, 4]) {
    const post = new Mesh(new CylinderGeometry(0.3, 0.35, 7, 10), red);
    post.position.set(x, 3.5, 0);
    gate.add(post);
  }
  const beam = new Mesh(new BoxGeometry(11, 0.5, 0.6), red);
  beam.position.y = 7;
  const beam2 = new Mesh(new BoxGeometry(9, 0.3, 0.4), red);
  beam2.position.y = 5.8;
  gate.add(beam, beam2);
  gate.position.set(0, 0, -24);
  scene.add(gate);
}

/** Grass blade instances; each is 3 flat-shaded triangles, so the whole field is ~66k triangles in one draw call. */
const GRASS = 22000;
const GRASS_HEIGHT = 0.28;

function buildGrass() {
  // A tapered blade: two base corners, two mid corners, one tip.
  const w = 0.04, h = GRASS_HEIGHT;
  const v = [[-w, 0], [w, 0], [-w * 0.6, h * 0.55], [w * 0.6, h * 0.55], [0.01, h]];
  const tris = [0, 1, 3, 0, 3, 2, 2, 3, 4].map((i) => [v[i][0], v[i][1], 0]);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(tris.flat()), 3));
  geo.computeVertexNormals();
  const base = new Color(0x1a3016), tip = new Color(0x5f9a3a), c = new Color();
  const col = new Float32Array(tris.length * 3);
  tris.forEach((p, i) => c.copy(base).lerp(tip, p[1] / h).toArray(col, i * 3));
  geo.setAttribute("color", new BufferAttribute(col, 3));

  const time = { value: 0 };
  const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  // Wind in world space so neighbouring blades sway together and waves roll across the field.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace("#include <project_vertex>", `
      vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
      float bend = position.y / ${h.toFixed(3)};
      float wave = sin(uTime * 1.6 - mvPosition.z * 0.35 + mvPosition.x * 0.15) * 0.6
                 + sin(uTime * 2.9 + mvPosition.x * 1.1 - mvPosition.z * 0.6) * 0.2;
      mvPosition.xz += vec2(0.25, 0.4) * (wave + 0.3) * bend * bend * 0.35;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
    `);
  };

  const grass = new InstancedMesh(geo, mat, GRASS);
  const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scale = new Vector3(), up = new Vector3(0, 1, 0);
  const tint = new Color();
  for (let i = 0; i < GRASS; i++) {
    // Denser near the player, where individual blades are visible.
    const depth = 1 + 33 * Math.random() ** 1.4;
    pos.set((Math.random() * 2 - 1) * (4 + depth * 0.75), 0, 1.5 - depth);
    q.setFromAxisAngle(up, Math.random() * Math.PI);
    const s = 0.6 + Math.random() * 0.8;
    scale.set(1, s, 1);
    grass.setMatrixAt(i, m.compose(pos, q, scale));
    grass.setColorAt(i, tint.setHSL(0.22 + Math.random() * 0.1, 0.3, 0.7 + Math.random() * 0.3));
  }
  grass.frustumCulled = false;
  grass.onBeforeRender = () => { time.value = performance.now() / 1000; };
  return grass;
}

/** Sunset bands from the horizon up, one colour per face for a low-poly look. */
const SKY_BANDS = [
  [0, new Color(0xb4506a)], [0.02, new Color(0xff8a4c)], [0.12, new Color(0xf0606a)],
  [0.35, new Color(0x7a3284)], [0.7, new Color(0x2a2058)], [1, new Color(0x141438)],
];

function buildSky() {
  const geo = new SphereGeometry(100, 36, 22).toNonIndexed();
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i += 3) {
    const h = Math.max(0, (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 300);
    const k = SKY_BANDS.findIndex(([at]) => at >= h);
    const [a, ca] = SKY_BANDS[Math.max(0, k - 1)], [b, cb] = SKY_BANDS[Math.max(0, k)];
    c.copy(ca).lerp(cb, b > a ? (h - a) / (b - a) : 0);
    for (let j = 0; j < 3; j++) c.toArray(col, (i + j) * 3);
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  return new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
}

/** A visible archer or thrower that Projectiles come from. */
export class Launcher {
  constructor(scene, position, kind) {
    this.kind = kind; // "archer" | "thrower"
    this.position = position;
    this.windup = 0; // 0..1 while about to launch

    this.body = new MeshStandardMaterial({ color: kind === "archer" ? 0x5a6490 : 0x8a4a5a, roughness: 0.8, emissive: 0xff3b3b, emissiveIntensity: 0 });
    const g = new Group();
    const torso = new Mesh(new CapsuleGeometry(0.28, 0.9, 4, 10), this.body);
    torso.position.y = 0.95;
    const head = new Mesh(new SphereGeometry(0.2, 12, 8), this.body);
    head.position.y = 1.75;
    g.add(torso, head);
    if (kind === "thrower") {
      this.hand = new Mesh(new SphereGeometry(0.12, 8, 6), this.body);
      this.hand.position.set(0.35, 1.3, 0.1);
      g.add(this.hand);
    }
    g.position.copy(position);
    g.lookAt(new Vector3(0, 0, 0));
    this.group = g;
    scene.add(g);
  }

  /** Where Projectiles leave from. */
  get muzzle() {
    const toPlayer = new Vector3().subVectors(PLAYER_HEAD, this.position).setY(0).normalize();
    return this.position.clone().add(new Vector3(0, 1.4, 0)).addScaledVector(toPlayer, 0.5);
  }

  update(dt) {
    this.body.emissiveIntensity = this.windup * 1.2;
    if (this.hand) this.hand.position.y = 1.3 + this.windup * 0.5;
    this.windup = Math.max(0, this.windup - dt * 3);
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

/** Launchers spread evenly across the arc, alternating archers and throwers. */
export function placeLaunchers(scene, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = -ARC + t * 2 * ARC;
    const r = 13 + ((i * 7) % 3) * 1.5;
    const pos = new Vector3(Math.sin(angle) * r, 0, -Math.cos(angle) * r);
    out.push(new Launcher(scene, pos, i % 2 === 0 ? "archer" : "thrower"));
  }
  return out;
}
