// Finds the four swing checkpoints in a live stream of poses by following the hands.
//
//  idle ──(hands low, centered, still)──▶ address ──(hands leave)──▶ backswing
//     ▲                                                                 │ (hands start dropping)
//     │                                                                 ▼
//  cooldown ◀──(still or timeout)── follow ◀──(hands past impact & rising)── downswing
//
// Distances are measured in torso lengths (shoulder-mid to hip-mid), so it works at any
// camera distance. Image y grows downward, so "higher" means a smaller y.

import { dist } from './geometry.js';

export const DETECTOR_DEFAULTS = {
  stillSpeed: 0.6, // torso lengths / second below which the hands count as still
  addressStillTime: 0.6, // seconds of stillness to lock in address
  addressTolerance: 0.1, // settling moves smaller than this still refresh the address frame
  startMove: 0.35, // hands this far from address = takeaway started
  minLift: 0.8, // the top must be at least this far above the address hands (else it was a waggle)
  topDrop: 0.3, // hands this far below the highest point = downswing started
  followRise: 0.3, // after impact, hands this far above address hands = follow-through
  finishStillTime: 0.35,
  backswingTimeout: 4,
  downswingTimeout: 1.5,
  followTimeout: 3,
  lostTimeout: 1,
  cooldown: 1.5,
};

export class SwingDetector {
  constructor(handlers = {}, cfg = {}) {
    this.h = handlers;
    this.cfg = { ...DETECTOR_DEFAULTS, ...cfg };
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.hist = [];
    this.stillSince = null;
    this.address = null;
    this.anchor = null;
    this.top = null;
    this.impact = null;
    this.impactD = Infinity;
    this.stateSince = 0;
    this.lastPoseT = null;
    this.lastPose = null;
  }

  _set(state, t) {
    this.state = state;
    this.stateSince = t;
    this.stillSince = null;
    this.h.onState?.(state);
  }

  _cancel(t, reason) {
    this.h.onCancel?.(reason);
    this.address = null;
    this._set('idle', t);
  }

  /** Hand speed in torso lengths per second over the last ~0.2 s (Infinity if unknown). */
  _speed(t, L) {
    const now = this.hist[this.hist.length - 1];
    let ref = null;
    for (let i = this.hist.length - 2; i >= 0; i--) {
      if (t - this.hist[i].t >= 0.15) {
        ref = this.hist[i];
        break;
      }
    }
    if (!ref || !now) return Infinity;
    return dist(now, ref) / L / (now.t - ref.t);
  }

  /** Feed one frame. pose may be null (nobody detected). t is in seconds. */
  update(pose, t) {
    const c = this.cfg;

    if (!pose) {
      if (this.lastPoseT != null && t - this.lastPoseT > c.lostTimeout) {
        if (this.state === 'follow' && this.lastPose) return this._finish(this.lastPose, false, t);
        if (['address', 'backswing', 'downswing'].includes(this.state)) return this._cancel(t, 'lost');
      }
      return;
    }
    this.lastPoseT = t;
    this.lastPose = pose;

    this.hist.push({ t, x: pose.hands.x, y: pose.hands.y });
    while (this.hist.length && t - this.hist[0].t > 1) this.hist.shift();

    const L = this.address?.torso ?? pose.torso;
    const speed = this._speed(t, L);
    const still = speed < c.stillSpeed;
    if (still) this.stillSince ??= t;
    else this.stillSince = null;
    const stillFor = this.stillSince == null ? 0 : t - this.stillSince;

    const handsLow = pose.hands.y > pose.hipMid.y - 0.2 * pose.torso;
    const centered = Math.abs(pose.hands.x - pose.hipMid.x) < 0.6 * pose.torso;

    switch (this.state) {
      case 'idle':
        if (handsLow && centered && stillFor >= c.addressStillTime) {
          this.address = pose;
          this.anchor = pose.hands;
          this._set('address', t);
          this.stillSince = t;
          this.h.onAddress?.(pose, true);
          this.h.onCandidate?.('address', pose);
        }
        break;

      case 'address': {
        const moved = dist(pose.hands, this.anchor) / L;
        const settled = handsLow && centered && speed < c.stillSpeed / 2;
        if (moved > c.startMove) {
          this.top = pose;
          this.h.onCandidate?.('top', pose);
          this._set('backswing', t);
        } else if (settled && moved < c.addressTolerance) {
          // Keep the baseline fresh for small settling moves, but only near the anchor so
          // the start of a slow takeaway never leaks into the address frame.
          this.address = pose;
          this.h.onAddress?.(pose, false);
          this.h.onCandidate?.('address', pose);
        } else if (!handsLow && !still && t - this.stateSince > 0.5 && moved > 0.15) {
          // Hands wandered up without a real takeaway (e.g. walking off). Start over.
          this._cancel(t, 'left-address');
        }
        break;
      }

      case 'backswing':
        if (pose.hands.y < this.top.hands.y) {
          this.top = pose;
          this.h.onCandidate?.('top', pose);
        }
        if (t - this.stateSince > c.backswingTimeout) {
          this._cancel(t, 'timeout');
        } else if (
          dist(pose.hands, this.anchor) / L < c.startMove / 2 &&
          (this.address.hands.y - this.top.hands.y) / L < c.minLift
        ) {
          // Waggle: the hands came back to the ball without a real backswing. Stay at address.
          this._set('address', t);
        } else if (pose.hands.y > this.top.hands.y + c.topDrop * L) {
          const lift = (this.address.hands.y - this.top.hands.y) / L;
          if (lift < c.minLift) {
            this._set('address', t); // half swing / waggle — not a full swing
          } else {
            this.impact = pose;
            this.impactD = dist(pose.hands, this.address.hands);
            this.h.onCandidate?.('impact', pose);
            this._set('downswing', t);
          }
        }
        break;

      case 'downswing': {
        const d = dist(pose.hands, this.address.hands);
        if (d < this.impactD) {
          this.impact = pose;
          this.impactD = d;
          this.h.onCandidate?.('impact', pose);
        }
        const pastImpact = d > this.impactD + 0.6 * L && pose.hands.y < this.address.hands.y - c.followRise * L;
        if (pastImpact || t - this.stateSince > c.downswingTimeout) this._set('follow', t);
        break;
      }

      case 'follow':
        if (stillFor >= c.finishStillTime) this._finish(pose, true, t);
        else if (t - this.stateSince > c.followTimeout) this._finish(pose, false, t);
        break;

      case 'cooldown':
        if (t - this.stateSince > c.cooldown) this._set('idle', t);
        break;
    }
  }

  /** End of input (e.g. the video ran out): close out a swing that is already in its follow-through. */
  flush(t) {
    if (this.state === 'follow' && this.lastPose) this._finish(this.lastPose, false, t);
  }

  _finish(pose, held, t) {
    this.h.onCandidate?.('finish', pose);
    const rec = { address: this.address, top: this.top, impact: this.impact, finish: pose, held };
    this._set('cooldown', t);
    this.h.onComplete?.(rec);
  }
}
