// MediaPipe Pose Landmarker wrapper with light temporal smoothing.

const TASKS_VERSION = '0.10.14';
const TASKS_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const MODEL_URL = (variant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;

/** Exponential smoothing of landmarks to calm jitter without adding much lag. */
class Smoother {
  constructor(alpha) {
    this.alpha = alpha;
    this.prev = null;
  }
  reset() {
    this.prev = null;
  }
  apply(list) {
    if (!list) {
      this.prev = null;
      return null;
    }
    if (!this.prev || this.prev.length !== list.length) {
      this.prev = list.map((l) => ({ ...l }));
      return this.prev;
    }
    const a = this.alpha;
    this.prev = list.map((l, i) => {
      const p = this.prev[i];
      return {
        x: p.x + a * (l.x - p.x),
        y: p.y + a * (l.y - p.y),
        z: p.z + a * (l.z - p.z),
        visibility: l.visibility,
      };
    });
    return this.prev;
  }
}

export async function createPoseEngine({ model = 'full', delegate = 'GPU' } = {}) {
  const { FilesetResolver, PoseLandmarker } = await import(`${TASKS_URL}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_URL}/wasm`);

  const make = (d) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL(model), delegate: d },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let landmarker;
  try {
    landmarker = await make(delegate);
  } catch (err) {
    if (delegate === 'CPU') throw err;
    console.warn('GPU delegate failed, falling back to CPU', err);
    landmarker = await make('CPU');
  }

  const img = new Smoother(0.65);
  const world = new Smoother(0.65);
  let lastTs = 0;

  return {
    detect(video, nowMs) {
      const ts = Math.max(Math.round(nowMs), lastTs + 1);
      lastTs = ts;
      const r = landmarker.detectForVideo(video, ts);
      const lm = r.landmarks?.[0];
      if (!lm) {
        img.reset();
        world.reset();
        return null;
      }
      return { landmarks: img.apply(lm), world: world.apply(r.worldLandmarks?.[0] ?? null) };
    },
    reset() {
      img.reset();
      world.reset();
    },
    close() {
      landmarker.close();
    },
  };
}
