// The Game-facing API, ported from pocketwand/room.py: a Room that Controllers join, polled for their state.
// Transport is a WebRTC data channel per phone, brokered by the public PeerJS server.

import Peer from "peerjs";
import { Quaternion, Vector3 } from "three";
import { fromDeviceAngles, recentreOffset, toThree } from "./orientation.js";
import { newRoomCode, peerId } from "./protocol.js";

const DEG = Math.PI / 180;
/** A Controller that hasn't sent anything for this long counts as gone (a locked phone stops sending). */
const STALE_MS = 1200;
/** Never extrapolate further than this past the last sample. */
const MAX_PREDICT_S = 0.05;

/** The live state of one Slot. */
export class Controller {
  constructor(slot) {
    this.slot = slot;
    this.button = false;
    this.hasGyro = false;
    this._raw = new Quaternion();
    this._offset = new Quaternion();
    this._rate = new Vector3(); // phone frame, rad/s
    this._accel = new Vector3(); // phone frame, m/s^2
    this._ts = -Infinity; // phone clock, ms
    this._receivedAt = -Infinity; // our clock, ms
    this._hasData = false;
    this._open = false;
    this._prevQ = null;
    this._prevTs = 0;
    this._diffRate = new Vector3(); // world, rad/s, used when the phone has no gyroscope
  }

  /** Open and still sending. */
  get connected() {
    return this._open && this._hasData && performance.now() - this._receivedAt < STALE_MS;
  }

  /** Rotation from phone frame to pocketwand world frame (+X right, +Y towards the screen, +Z up). */
  get orientation() {
    return this._offset.clone().multiply(this._raw);
  }

  /**
   * Rotation from phone frame to the Three.js world, extrapolated along the gyroscope reading
   * to "now" so the Sword doesn't visibly lag between samples.
   */
  quaternion(predict = true) {
    const q = toThree(this.orientation);
    if (!predict || !this.hasGyro) return q;
    const age = Math.min((performance.now() - this._receivedAt) / 1000, MAX_PREDICT_S);
    const angle = this._rate.length() * age;
    if (angle < 1e-5) return q;
    // The rate is in the phone frame, so the extra rotation is applied on the right.
    return q.multiply(new Quaternion().setFromAxisAngle(this._rate.clone().normalize(), angle));
  }

  /** Angular velocity in the Three.js world frame, rad/s. */
  angularVelocity() {
    if (!this.hasGyro) return this._diffRate.clone();
    return this._rate.clone().applyQuaternion(toThree(this.orientation));
  }

  /** Swing speed in deg/s. */
  get swingSpeed() {
    return this.angularVelocity().length() / DEG;
  }

  recenter() {
    this._offset = recentreOffset(this._raw);
  }

  _update(m) {
    const ts = Number(m.ts) || performance.now();
    if (ts < this._ts) return; // the channel is unordered; drop samples older than what we have
    this._ts = ts;
    this._receivedAt = performance.now();
    this._raw = fromDeviceAngles(+m.a || 0, +m.b || 0, +m.g || 0);
    this.button = !!m.p;

    if (Array.isArray(m.r) && m.r.every(Number.isFinite)) {
      // rotationRate alpha/beta/gamma are about the phone's Z/X/Y axes.
      const [alpha, beta, gamma] = m.r;
      this._rate.set(beta * DEG, gamma * DEG, alpha * DEG);
      this.hasGyro = true;
    }
    if (Array.isArray(m.m) && m.m.every(Number.isFinite)) this._accel.fromArray(m.m);

    if (!this._hasData) {
      this._hasData = true;
      this.recenter();
    }

    if (!this.hasGyro) this._differentiate(ts);
  }

  _differentiate(ts) {
    const q = toThree(this.orientation);
    if (this._prevQ) {
      const dt = (ts - this._prevTs) / 1000;
      if (dt > 0.004 && dt < 0.2) {
        const dq = q.clone().multiply(this._prevQ.clone().invert());
        if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
        const angle = 2 * Math.acos(Math.min(1, dq.w));
        const s = Math.sqrt(1 - dq.w * dq.w);
        if (s > 1e-6) this._diffRate.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
        else this._diffRate.set(0, 0, 0);
      }
    }
    this._prevQ = q;
    this._prevTs = ts;
  }
}

/** One Game's session. Creating it registers the Room code with the PeerJS broker. */
export class Room {
  /**
   * @param {{code?: string, onStatus?: (status: "connecting"|"ready"|"error", detail?: string) => void}} opts
   */
  constructor({ code, onStatus } = {}) {
    this.code = code || newRoomCode();
    this.onJoin = null;
    this.onLeave = null;
    this.onStatus = onStatus || (() => {});
    this._controllers = new Map();
    this._slotsById = new Map();
    this._connsBySlot = new Map();
    this._open();
  }

  /** The Controller in `slot`. Never null: an empty Slot reads as disconnected. */
  controller(slot = 0) {
    if (!this._controllers.has(slot)) this._controllers.set(slot, new Controller(slot));
    return this._controllers.get(slot);
  }

  /** Every Controller that is currently connected, ordered by Slot. */
  get controllers() {
    return [...this._controllers.values()].sort((a, b) => a.slot - b.slot).filter((c) => c.connected);
  }

  close() {
    this._peer?.destroy();
  }

  _open() {
    this.onStatus("connecting");
    const peer = new Peer(peerId(this.code), { debug: 1 });
    this._peer = peer;
    peer.on("open", () => this.onStatus("ready"));
    peer.on("connection", (conn) => this._accept(conn));
    peer.on("disconnected", () => {
      // Lost the broker, not the phones: existing data channels keep working, but new phones can't join.
      if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000);
    });
    peer.on("error", (err) => {
      if (err.type === "unavailable-id") {
        // Someone (probably this tab before a reload) still holds the code; take a fresh one.
        peer.destroy();
        this.code = newRoomCode();
        this._open();
      } else if (err.type === "peer-unavailable") {
        // Not ours to handle: only happens for outgoing connections.
      } else {
        this.onStatus("error", err.type || String(err));
      }
    });
  }

  _accept(conn) {
    const id = String(conn.metadata?.id || conn.peer);
    if (!this._slotsById.has(id)) this._slotsById.set(id, this._slotsById.size);
    const slot = this._slotsById.get(id);
    const controller = this.controller(slot);

    conn.on("open", () => {
      // The same phone reconnecting (e.g. a reloaded tab) replaces its old connection.
      const old = this._connsBySlot.get(slot);
      this._connsBySlot.set(slot, conn);
      if (old && old !== conn) old.close();
      controller._open = true;
      conn.send({ t: "slot", slot });
      this.onJoin?.(controller);
    });
    conn.on("data", (m) => {
      if (!m || typeof m !== "object") return;
      if (m.t === "recentre") controller.recenter();
      else if ("a" in m) controller._update(m);
    });
    const closed = () => {
      if (this._connsBySlot.get(slot) !== conn) return;
      this._connsBySlot.delete(slot);
      controller._open = false;
      this.onLeave?.(controller);
    };
    conn.on("close", closed);
    conn.on("error", closed);
  }
}
