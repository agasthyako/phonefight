import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

/**
 * Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9).
 * Writes the points into c1 and c2 and returns the squared distance.
 */
export function closestSegmentSegment(p1, q1, p2, q2, c1, c2) {
  const d1 = _a.subVectors(q1, p1);
  const d2 = _b.subVectors(q2, p2);
  const r = _c.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-9) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceToSquared(c2);
}

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Cuts a non-indexed geometry (position + color attributes) by a plane given in its local space.
 * Returns [front, back] geometries, or null when the plane misses the geometry.
 * With `cap`, the cut face is filled with `innerColor`; that fill is only correct for convex shapes.
 */
export function splitGeometry(geometry, plane, innerColor, cap = true) {
  const pos = geometry.getAttribute("position");
  const col = geometry.getAttribute("color");
  const sides = [{ p: [], c: [] }, { p: [], c: [] }];
  const cut = [];
  const v = [new Vector3(), new Vector3(), new Vector3()];
  const k = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const d = [0, 0, 0];

  for (let i = 0; i < pos.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      v[j].fromBufferAttribute(pos, i + j);
      k[j] = [col.getX(i + j), col.getY(i + j), col.getZ(i + j)];
      d[j] = plane.distanceToPoint(v[j]);
    }
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      // Sutherland–Hodgman against one half-space.
      const poly = [];
      for (let j = 0; j < 3; j++) {
        const n = (j + 1) % 3;
        const dj = d[j] * sign, dn = d[n] * sign;
        if (dj >= 0) poly.push([v[j].clone(), k[j]]);
        if ((dj >= 0) !== (dn >= 0)) {
          const t = dj / (dj - dn);
          const p = v[j].clone().lerp(v[n], t);
          poly.push([p, k[j].map((x, m) => x + (k[n][m] - x) * t)]);
          if (side === 0) cut.push(p);
        }
      }
      for (let j = 1; j + 1 < poly.length; j++) {
        for (const [p, c] of [poly[0], poly[j], poly[j + 1]]) {
          sides[side].p.push(p.x, p.y, p.z);
          sides[side].c.push(...c);
        }
      }
    }
  }
  if (!sides[0].p.length || !sides[1].p.length) return null;

  if (cap && cut.length >= 3) {
    const ring = capRing(cut, plane.normal);
    const centre = ring.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(ring.length);
    const inner = [innerColor.r, innerColor.g, innerColor.b];
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j], b = ring[(j + 1) % ring.length];
      // Front piece's cap faces -normal, back piece's faces +normal.
      for (const p of [centre, b, a]) { sides[0].p.push(p.x, p.y, p.z); sides[0].c.push(...inner); }
      for (const p of [centre, a, b]) { sides[1].p.push(p.x, p.y, p.z); sides[1].c.push(...inner); }
    }
  }

  return sides.map(({ p, c }) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(p, 3));
    g.setAttribute("color", new Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** The cut points, deduplicated and sorted around their centre in the plane. */
function capRing(points, normal) {
  const centre = points.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(points.length);
  const u = new Vector3().subVectors(points[0], centre);
  if (u.lengthSq() < 1e-12) u.set(1, 0, 0).cross(normal);
  u.normalize();
  const w = new Vector3().crossVectors(normal, u);
  const withAngle = points.map((p) => {
    const r = new Vector3().subVectors(p, centre);
    return { p, angle: Math.atan2(r.dot(w), r.dot(u)) };
  });
  withAngle.sort((a, b) => a.angle - b.angle);
  const ring = [];
  for (const { p } of withAngle) {
    if (!ring.length || ring[ring.length - 1].distanceToSquared(p) > 1e-8) ring.push(p);
  }
  if (ring.length > 1 && ring[0].distanceToSquared(ring[ring.length - 1]) < 1e-8) ring.pop();
  return ring;
}

/** A primitive as non-indexed geometry with a flat vertex colour, ready for splitGeometry. */
export function coloured(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute("uv");
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  g.setAttribute("color", new Float32BufferAttribute(c, 3));
  return g;
}
