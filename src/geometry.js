// Pose geometry helpers. Pure functions — no DOM, no MediaPipe — so they are unit-testable.

/** MediaPipe Pose landmark indices we care about. */
export const LM = {
  NOSE: 0,
  L_EAR: 7,
  R_EAR: 8,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
};

export const METERS_TO_INCHES = 39.3701;

export const mid = (a, b) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
});

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const toDeg = (r) => (r * 180) / Math.PI;

/** Angle ABC (at B) in degrees, using x/y/z. */
export function angle3(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const m = Math.hypot(v1.x, v1.y, v1.z) * Math.hypot(v2.x, v2.y, v2.z);
  if (!m) return null;
  return toDeg(Math.acos(clamp(dot / m, -1, 1)));
}

/** Heading of the a→b vector in the horizontal (x/z) plane, degrees. */
export const yawDeg = (a, b) => toDeg(Math.atan2((b.z ?? 0) - (a.z ?? 0), b.x - a.x));

/** Smallest absolute difference between two angles, in [0, 180]. */
export function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

const REQUIRED = ['L_SHOULDER', 'R_SHOULDER', 'L_HIP', 'R_HIP', 'L_WRIST', 'R_WRIST'];

/**
 * Turn raw MediaPipe output (normalized image landmarks + world landmarks in meters)
 * into a pose object in video pixel coordinates with handy derived points.
 * Returns null if the core body is not confidently visible.
 */
export function buildPose(landmarks, world, w, h, minVis = 0.5) {
  if (!landmarks || landmarks.length < 33) return null;
  const pts = {};
  for (const [name, i] of Object.entries(LM)) {
    const l = landmarks[i];
    pts[name] = { x: l.x * w, y: l.y * h, v: l.visibility ?? 1 };
  }
  if (REQUIRED.some((k) => pts[k].v < minVis)) return null;

  let wpts = null;
  if (world && world.length >= 33) {
    wpts = {};
    for (const [name, i] of Object.entries(LM)) {
      const l = world[i];
      wpts[name] = { x: l.x, y: l.y, z: l.z };
    }
  }

  const shoulderMid = mid(pts.L_SHOULDER, pts.R_SHOULDER);
  const hipMid = mid(pts.L_HIP, pts.R_HIP);
  const hands = mid(pts.L_WRIST, pts.R_WRIST);
  const headPts = [pts.NOSE, pts.L_EAR, pts.R_EAR].filter((p) => p.v >= 0.3);
  const head = headPts.length
    ? {
        x: headPts.reduce((s, p) => s + p.x, 0) / headPts.length,
        y: headPts.reduce((s, p) => s + p.y, 0) / headPts.length,
      }
    : { x: shoulderMid.x, y: shoulderMid.y - dist(shoulderMid, hipMid) * 0.45 };

  return {
    pts,
    world: wpts,
    shoulderMid,
    hipMid,
    hands,
    head,
    torso: Math.max(1, dist(shoulderMid, hipMid)),
    feetVisible: pts.L_ANKLE.v >= 0.3 && pts.R_ANKLE.v >= 0.3,
    w,
    h,
  };
}

/**
 * Real-world scale for this frame: inches per video pixel.
 * Compares the shoulder→hip→knee→ankle chain length in world space (meters)
 * to the same chain in image space (pixels). Segment lengths survive the
 * forward bend at address much better than standing height would.
 */
export function inchesPerPixel(pose) {
  if (!pose) return null;
  if (pose.world) {
    let imgLen = 0;
    let worldLen = 0;
    for (const s of ['L', 'R']) {
      const chain = [`${s}_SHOULDER`, `${s}_HIP`, `${s}_KNEE`, `${s}_ANKLE`];
      for (let i = 0; i < chain.length - 1; i++) {
        imgLen += dist(pose.pts[chain[i]], pose.pts[chain[i + 1]]);
        worldLen += dist3(pose.world[chain[i]], pose.world[chain[i + 1]]);
      }
    }
    if (imgLen > 0 && worldLen > 0) return (worldLen * METERS_TO_INCHES) / imgLen;
  }
  // Fallback: an adult shoulder-to-hip distance is roughly 20 inches.
  return 20 / pose.torso;
}
