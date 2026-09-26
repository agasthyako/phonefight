// The Game: lobby (attract mode + QR code) → calibrate (Recentre) → play Waves → game over.

import QRCode from "qrcode";
import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Room } from "../pocket/room.js";
import { joinUrl } from "../pocket/protocol.js";
import { buildArena } from "./arena.js";
import { Audio } from "./audio.js";
import { Bot } from "./bot.js";
import { Fx } from "./fx.js";
import { Projectiles } from "./projectiles.js";
import { Sword } from "./sword.js";
import { SwordTarget } from "./target.js";
import { WaveDirector } from "./waves.js";

const LIVES = 3;
const STILL_FOR = 1.0; // seconds of holding still that triggers the Recentre
const WAVE_BREAK = 2.2;

const $ = (id) => document.getElementById(id);

// ---------- Rendering ----------

const canvas = $("view");
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;

const scene = new Scene();
const camera = new PerspectiveCamera(70, 1, 0.05, 200);
const CAMERA_HOME = new Vector3(0, 1.6, 0.4);
camera.position.copy(CAMERA_HOME);
camera.lookAt(0, 1.4, -6);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.35, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

buildArena(scene);

// ---------- Game objects ----------

const audio = new Audio();
const fx = new Fx(scene, camera);
const sword = new Sword(scene);
const bot = new Bot();

let mode = "lobby"; // lobby | calibrate | playing | gameover
let paused = null; // null, or the overlay being shown for it: "paused" (phone lost) or "held" (player paused)
let held = false; // the player asked to pause
let buttonWas = false;
let score = 0;
let lives = LIVES;
let waveBreak = 0;
let hitstop = 0;
let shake = 0;
let stillTime = 0;
let restart = null;
let disconnectedFor = 0;

const projectiles = new Projectiles(scene, {
  onDeflect(p, at, away) {
    fx.deflect(at, away);
    audio.clang();
    hitstop = Math.max(hitstop, 0.035);
    if (mode === "playing") addScore(1);
  },
  onSlice(p, at) {
    fx.slice(at, p.k.glow);
    audio.slice();
    hitstop = Math.max(hitstop, 0.06);
    if (mode === "playing") addScore(2);
  },
  onHitPlayer() {
    if (mode !== "playing") return;
    lives--;
    renderLives();
    audio.hurt();
    shake = 0.25;
    $("hurt").classList.add("on");
    requestAnimationFrame(() => requestAnimationFrame(() => $("hurt").classList.remove("on")));
    if (lives <= 0) gameOver();
  },
});
const director = new WaveDirector(scene, projectiles);

// ---------- Room ----------

let savedCode = null;
try { savedCode = sessionStorage.getItem("phonefight-room"); } catch {}

const room = new Room({
  code: savedCode,
  onStatus(status, detail) {
    if (status === "ready") showJoin();
    if (status === "error") warn(`Couldn't reach the matchmaking server (${detail}). Check your connection and reload.`);
  },
});

function showJoin() {
  try { sessionStorage.setItem("phonefight-room", room.code); } catch {}
  const url = joinUrl(room.code);
  $("url").textContent = url;
  $("roomTag").textContent = `Room ${room.code}`;
  const box = $("qr");
  box.textContent = "";
  if (!url.startsWith("https:")) {
    // A phone can't reach localhost or a LAN address over plain http with motion sensors, so don't offer a dead code.
    box.innerHTML = `<span class="muted center" style="padding:8px">No HTTPS link.<br>Run <b>npm run share</b></span>`;
    return;
  }
  const c = document.createElement("canvas");
  box.append(c);
  QRCode.toCanvas(c, url, { width: 140, margin: 0, color: { dark: "#0e1116", light: "#ffffff" } });
}

function warn(text) {
  $("warn").textContent = text;
  $("warn").hidden = false;
}

if (!joinUrl("X").startsWith("https:")) {
  warn("Phones only share motion over HTTPS. Run “npm run share” and open the trycloudflare.com link it prints, or open the deployed site.");
}

// ---------- Handedness ----------

function setHand(hand) {
  sword.handedness = hand;
  sword.reset();
  for (const b of $("hand").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.hand === hand));
  try { localStorage.setItem("phonefight-hand", hand); } catch {}
}
$("hand").addEventListener("click", (e) => { if (e.target.dataset.hand) setHand(e.target.dataset.hand); });
try { setHand(localStorage.getItem("phonefight-hand") || "right"); } catch { setHand("right"); }

// ---------- Sound ----------

const unlock = () => audio.unlock();
addEventListener("pointerdown", unlock);
addEventListener("keydown", unlock);
$("sound").onclick = () => {
  audio.setEnabled(!audio.enabled);
  $("sound").textContent = `Sound: ${audio.enabled ? "on" : "off"}`;
};

/** Pause or resume, from the phone's Hold button, the on-screen button, P or Escape. Only mid-game. */
function togglePause() {
  if (mode !== "playing") return;
  held = !held;
  $("pause").textContent = held ? "Resume" : "Pause";
}
$("pause").onclick = togglePause;
$("resume").onclick = togglePause;

addEventListener("keydown", (e) => {
  if (e.key === "Enter" && mode === "gameover") startGame();
  if (e.key === "p" || e.key === "P" || e.key === "Escape") togglePause();
  if (e.key === "r" || e.key === "R") { room.controller(0).recenter(); sword.reset(); }
});

// ---------- Modes ----------

function show(overlay) {
  for (const id of ["lobby", "calibrate", "paused", "held", "gameover"]) $(id).classList.toggle("on", id === overlay);
}

function enterLobby() {
  mode = "lobby";
  clearField();
  show("lobby");
  $("hud").classList.remove("on");
  $("speed").classList.remove("on");
  $("pause").hidden = true;
  director.start(1);
}

function enterCalibrate() {
  mode = "calibrate";
  clearField();
  stillTime = 0;
  sword.reset();
  show("calibrate");
}

function startGame() {
  restart?.dispose();
  restart = null;
  clearField();
  score = 0;
  lives = LIVES;
  mode = "playing";
  show(null);
  $("hud").classList.add("on");
  $("speed").classList.add("on");
  $("pause").hidden = false;
  renderLives();
  addScore(0);
  startWave(1);
}

function startWave(n) {
  director.start(n);
  $("wave").textContent = `Wave ${n}`;
  banner(`Wave ${n}`, 1.4);
  audio.chime();
}

function gameOver() {
  mode = "gameover";
  director.clear();
  held = false;
  $("pause").hidden = true;
  $("final").textContent = `You reached Wave ${director.number} with a Score of ${score}.`;
  show("gameover");
  restart = new SwordTarget(scene, "RESTART", new Vector3(-0.2, 1.45, -1.3), (at) => {
    fx.burst(at, 0xffb547);
    audio.slice();
    startGame();
  });
}

function clearField() {
  held = false;
  $("pause").textContent = "Pause";
  projectiles.clear();
  director.clear();
  waveBreak = 0;
}

function addScore(n) {
  score += n;
  const el = $("score");
  el.textContent = score;
  if (n > 0) {
    // Restart the pop so rapid hits each get their own pulse.
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
}

function renderLives() {
  $("lives").innerHTML = Array.from({ length: LIVES }, (_, i) => `<span class="${i < lives ? "" : "lost"}">♥</span>`).join("");
}

let bannerTimer = 0;
function banner(text, seconds) {
  $("banner").textContent = text;
  $("banner").classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $("banner").classList.remove("on"), seconds * 1000);
}

// ---------- Loop ----------

const controller = room.controller(0);
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const live = controller.connected;
  if (mode === "lobby" && live) enterCalibrate();
  if (controller.button && !buttonWas) togglePause();
  buttonWas = controller.button;

  // Pause (not end) when the phone goes quiet mid-game; a short grace hides network hiccups.
  if (mode !== "lobby") {
    disconnectedFor = live ? 0 : disconnectedFor + dt;
    const shouldPause = disconnectedFor > 0.4 ? "paused" : held ? "held" : null;
    if (shouldPause !== paused) {
      paused = shouldPause;
      if (paused) show(paused);
      else {
        sword.reset();
        show(mode === "calibrate" ? "calibrate" : mode === "gameover" ? "gameover" : null);
      }
    }
    // Waiting on the paused screen for long: give up and go back to the lobby for the next visitor.
    if (paused === "paused" && disconnectedFor > 60) { paused = null; enterLobby(); }
  }

  if (!paused) step(dt);
  fx.update(dt);

  // Camera shake after being hit.
  shake = Math.max(0, shake - dt);
  camera.position.copy(CAMERA_HOME).add(new Vector3(
    (Math.random() - 0.5) * shake * 0.2, (Math.random() - 0.5) * shake * 0.2, 0,
  ));

  composer.render();
}

function step(dt) {
  // Hitstop: a few frames of slow motion on contact make hits feel solid.
  let simDt = dt;
  if (hitstop > 0) {
    hitstop -= dt;
    simDt = dt * 0.2;
  }

  if (mode === "lobby") {
    sword.update(bot.update(simDt, sword, projectiles), null, simDt);
  } else {
    sword.update(controller.quaternion(), controller.hasGyro ? controller.angularVelocity() : null, dt);
  }
  audio.swing(mode === "lobby" ? 0 : sword.swingSpeed);
  $("speed").firstElementChild.style.width = Math.min(100, sword.swingSpeed / 12) + "%";

  if (mode === "calibrate") {
    calibrate(dt);
    return;
  }

  if (mode === "lobby" || mode === "playing") director.update(simDt);
  projectiles.update(simDt, sword);
  restart?.update(dt, sword);

  if (director.done && (mode === "playing" || mode === "lobby")) {
    if (waveBreak <= 0) {
      waveBreak = WAVE_BREAK;
      if (mode === "playing") banner(`Wave ${director.number} cleared`, 1.2);
    }
    waveBreak -= dt;
    if (waveBreak <= 0) {
      if (mode === "playing") startWave(director.number + 1);
      else director.start((director.number % 6) + 1);
    }
  }
}

function calibrate(dt) {
  // Held still with the blade roughly level: that's "pointing at the screen".
  const up = new Vector3(0, 1, 0).applyQuaternion(controller.orientation);
  const level = Math.abs(up.z) < 0.5;
  const still = controller.swingSpeed < 30;
  stillTime = level && still ? stillTime + dt : Math.max(0, stillTime - dt * 2);
  const k = Math.min(1, stillTime / STILL_FOR);
  $("ringFill").setAttribute("stroke-dashoffset", String(326.7 * (1 - k)));
  if (k >= 1) {
    controller.recenter();
    sword.reset();
    startGame();
  }
}

enterLobby();
requestAnimationFrame(frame);

// Debug handle for the console.
window.phonefight = { room, projectiles, director, sword, get mode() { return mode; } };
