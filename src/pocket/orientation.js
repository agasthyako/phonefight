// Orientation maths, ported from pocketwand/orientation.py.
//
// pocketwand world frame (after Recentre): +X right, +Y forward (towards the screen), +Z up.
// Phone frame: +X right edge of the screen, +Y top of the phone, +Z out of the screen.
// The Game's Three.js world is +X right, +Y up, -Z forward; toThree() maps between them.

import { Quaternion, Vector3 } from "three";

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const DEG = Math.PI / 180;

/** Browser DeviceOrientationEvent angles (degrees) to a quaternion: Z(alpha) X(beta) Y(gamma), intrinsic. */
export function fromDeviceAngles(alpha, beta, gamma) {
  return new Quaternion()
    .setFromAxisAngle(Z, alpha * DEG)
    .multiply(new Quaternion().setFromAxisAngle(X, beta * DEG))
    .multiply(new Quaternion().setFromAxisAngle(Y, gamma * DEG));
}

/** The heading-only correction that makes the phone's current facing count as forward. */
export function recentreOffset(raw) {
  const top = new Vector3(0, 1, 0).applyQuaternion(raw);
  const back = new Vector3(0, 0, -1).applyQuaternion(raw);
  const f = Math.hypot(top.x, top.y) > 0.5 ? top : back;
  const heading = Math.atan2(-f.x, f.y);
  return new Quaternion().setFromAxisAngle(Z, -heading);
}

// Rotation of -90 degrees about X: pocketwand (x, y, z) -> Three.js (x, z, -y).
const PW_TO_THREE = new Quaternion().setFromAxisAngle(X, -Math.PI / 2);

/** A phone-frame -> pocketwand-world rotation as a phone-frame -> Three.js-world rotation. */
export function toThree(q) {
  return PW_TO_THREE.clone().multiply(q);
}
