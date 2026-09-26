// The Controller page: streams this phone's motion to the Game over a WebRTC data channel.
// Adapted from pocketwand's controller.html.

import Peer from "peerjs";
import { PROTOCOL_VERSION, peerId } from "../pocket/protocol.js";

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("on", s.id === id);
};

const room = new URLSearchParams(location.search).get("room")?.toUpperCase() || "";

// A stable random id lets this phone reclaim its Slot after reconnecting.
let id;
try { id = localStorage.getItem("phonefight-id"); } catch {}
if (!id) {
  id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem("phonefight-id", id); } catch {}
}

const state = { a: null, b: null, g: null, r: null, m: null, p: 0 };
let peer = null, conn = null, failures = 0, gotMotion = false;

show(room ? "start" : "noroom");

$("enable").onclick = async () => {
  // iOS only hands out sensor data after these permission calls, made directly from a tap.
  for (const Ev of [globalThis.DeviceOrientationEvent, globalThis.DeviceMotionEvent]) {
    if (typeof Ev?.requestPermission !== "function") continue;
    try {
      if ((await Ev.requestPermission()) !== "granted") {
        $("msg").textContent = "Motion access was denied. Close this tab, reopen the link and tap Allow.";
        return;
      }
    } catch (e) {
      $("msg").textContent = "Couldn't ask for motion access: " + e.message;
      return;
    }
  }
  if (!window.isSecureContext) {
    $("msg").textContent = "This page needs HTTPS for motion sensors.";
    return;
  }
  window.addEventListener("deviceorientation", (e) => { state.a = e.alpha; state.b = e.beta; state.g = e.gamma; });
  window.addEventListener("devicemotion", onMotion);
  show("pad");
  keepAwake();
  connect();
  requestAnimationFrame(fallbackLoop);
  setTimeout(() => {
    if (state.b === null) $("conn").textContent = "No motion data. This device may not have motion sensors.";
  }, 2000);
};

function onMotion(e) {
  gotMotion = true;
  const r = e.rotationRate;
  if (r && r.alpha !== null) state.r = [r.alpha, r.beta, r.gamma];
  const m = e.acceleration;
  if (m && m.x !== null) state.m = [m.x, m.y, m.z];
  send(e.timeStamp);
}

// Phones without a gyroscope never fire devicemotion with data; send orientation on animation frames instead.
function fallbackLoop(t) {
  requestAnimationFrame(fallbackLoop);
  if (!gotMotion) send(t);
}

function connect() {
  $("conn").textContent = "Connecting…";
  if (!peer || peer.destroyed) {
    peer = new Peer({ debug: 1 });
    peer.on("open", openChannel);
    peer.on("disconnected", () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        failures++;
        $("conn").textContent = failures > 3
          ? "Can't find that Room. Check the code, or scan the new QR code."
          : "Waiting for the Game…";
        retry(Math.min(1000 * failures, 5000));
      } else {
        $("conn").textContent = "Connection problem (" + err.type + "). Retrying…";
        setTimeout(() => { peer.destroy(); connect(); }, 2000);
      }
    });
  } else if (peer.open) {
    openChannel();
  }
}

let retryTimer = 0;
function retry(ms) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(openChannel, ms);
}

function openChannel() {
  if (!peer.open) return; // the peer's own "open" event will call back here
  // Unordered, so one late packet never holds up the newer ones behind it.
  const c = peer.connect(peerId(room), { reliable: false, serialization: "json", metadata: { id } });
  conn = c;
  c.on("open", () => { failures = 0; $("conn").innerHTML = `<b>Connected</b> · Room ${room}`; });
  c.on("data", (m) => { if (m?.t === "slot") $("slot").textContent = "Slot " + m.slot; });
  c.on("close", () => {
    if (conn !== c) return;
    $("conn").textContent = "Reconnecting…";
    $("slot").textContent = "";
    retry(1000);
  });
}

let meterAt = 0;
function send(ts) {
  if (!conn?.open || state.b === null) return;
  // Drop samples rather than queue them: stale orientation is worse than missing orientation.
  if (conn.dataChannel?.bufferedAmount > 1024) return;
  conn.send({ v: PROTOCOL_VERSION, ts, a: state.a, b: state.b, g: state.g, r: state.r, m: state.m, p: state.p });

  if (ts - meterAt > 50 && state.r) {
    meterAt = ts;
    const speed = Math.hypot(...state.r);
    $("meter").firstElementChild.style.width = Math.min(100, speed / 10) + "%";
  }
}

const hold = $("hold");
const press = (down) => (e) => { e.preventDefault(); state.p = down ? 1 : 0; hold.classList.toggle("down", down); };
hold.addEventListener("pointerdown", press(true));
hold.addEventListener("pointerup", press(false));
hold.addEventListener("pointercancel", press(false));
hold.addEventListener("pointerleave", press(false));

$("recentre").onclick = () => { if (conn?.open) conn.send({ t: "recentre" }); };

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });

// Debug handle for the console.
window.phonefight = { get peer() { return peer; }, get conn() { return conn; }, state };
