// Build synthetic pose objects shaped like geometry.buildPose() output.
export function makePose({
  hands = { x: 500, y: 900 },
  hipMid = { x: 500, y: 850 },
  shoulderMid = { x: 500, y: 650 },
  head = { x: 500, y: 540 },
  shoulderHalf = 75,
  ankleHalf = 105,
  ankleY = 1250,
  world = null,
} = {}) {
  const pts = {
    L_SHOULDER: { x: shoulderMid.x + shoulderHalf, y: shoulderMid.y, v: 1 },
    R_SHOULDER: { x: shoulderMid.x - shoulderHalf, y: shoulderMid.y, v: 1 },
    L_HIP: { x: hipMid.x + 45, y: hipMid.y, v: 1 },
    R_HIP: { x: hipMid.x - 45, y: hipMid.y, v: 1 },
    L_ANKLE: { x: 500 + ankleHalf, y: ankleY, v: 1 },
    R_ANKLE: { x: 500 - ankleHalf, y: ankleY, v: 1 },
    L_WRIST: { x: hands.x + 10, y: hands.y, v: 1 },
    R_WRIST: { x: hands.x - 10, y: hands.y, v: 1 },
  };
  return {
    pts,
    world,
    shoulderMid,
    hipMid,
    hands,
    head,
    torso: Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y),
    feetVisible: true,
    w: 1000,
    h: 1400,
  };
}
