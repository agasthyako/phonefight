// What the Controller page and the Game agree on.

/** PeerJS ids are global on the public broker, so Room codes are namespaced. */
export const PEER_PREFIX = "phonefight-v1-";

export const PROTOCOL_VERSION = 2;

/** Room codes avoid look-alike characters so they can be typed on a phone. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newRoomCode(length = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function peerId(roomCode) {
  return PEER_PREFIX + roomCode.toUpperCase();
}

/**
 * Where a phone joins a Room: the Controller page next to the Game page. Under `npm run share` the
 * public tunnel URL is used, so the QR code works even when the Game was opened on localhost.
 */
export function joinUrl(roomCode) {
  const base = import.meta.env.VITE_PUBLIC_URL ? import.meta.env.VITE_PUBLIC_URL + "/" : location.href;
  const url = new URL("controller.html", base);
  url.search = `?room=${roomCode}`;
  return url.href;
}
