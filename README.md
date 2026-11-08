# Swing Coach

Live golf swing analysis in the browser. Point your phone's camera at yourself, set up, swing, and get a
checkpoint-by-checkpoint breakdown compared with tour-pro reference ranges, plus a spoken tip after every swing.

Everything runs on-device with [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).
No video leaves the phone.

## What it does

- **Live skeleton overlay.** Limbs, joints, spine line, shoulder and hip lines, a head box, and a dashed reference line from your address head position down to the ball.
- **Automatic swing detection.** It follows your hands to find four checkpoints. You never touch the phone.
  1. **Address**: hands low and still. The head box locks in.
  2. **Top**: highest hand position in the backswing.
  3. **Impact**: hands back closest to their address position.
  4. **Finish**: hands high and settled (or a timeout if you never hold it).
- **"You vs. Tour Pro" cards** for each checkpoint, each metric rated green, yellow or red:

  | Checkpoint | Metrics |
  |---|---|
  | Address | Ball position, spine tilt, stance width |
  | Top | Head shift, hip sway, shoulder turn (est.), lead arm |
  | Impact | Hip shift toward target, head behind ball, hands ahead of ball, hips open (est.) |
  | Finish | Weight transfer, balance (held finish), high hands |

- **Live head shift / hip shift readout** in inches. The scale comes from MediaPipe's metric world landmarks, so no calibration is needed.
- **Voice coach.** After each swing it says the single most important fix, with impact faults first.
- **Review mode.** Thumbnails of all four checkpoints, cycling automatically. It returns to live when you address the next ball.
- **Analyze a video.** Load a recorded swing, including slow-motion clips, and play it back at 1×, 0.5× or 0.25×.
- **Auto-edit a slow-mo swing video.** Pick a clip from your camera roll and get back a shareable MP4 that:
  - trims away everything except the swing (a short lead-in before address through just after the finish), and does this for every swing in the clip,
  - **pauses at address, top, impact and finish** with the skeleton and the You-vs-Tour-Pro card drawn on, plus the top fix for that position,
  - finishes on a score and the main coaching tip,
  - **detects slow motion on its own.** It tries 1×–16× and keeps the factor where your downswing takes a realistic ~0.3 s. You can also set it by hand,
  - lets you choose the pause length, slow the swing down further (2× or 4×), and show or hide the skeleton.

## Setup for a good reading

- **Face-on view.** The camera is in front of you, square to your chest, at about hip height, 8–12 ft away.
- Keep your whole body, your feet and the ball in the frame.
- Tap **Set ball**, then tap the ball on screen. This turns on the ball-position and hands-vs-ball metrics.
- Choose right- or left-handed and irons or driver on the start screen. The reference ranges change with the club.
- Higher frame rates catch impact better. The app asks for 60 fps where the camera supports it.

## Run locally

Camera access needs HTTPS or `localhost`.

```bash
npm start          # serves on http://localhost:8080
npm test           # unit tests for metrics + swing detection (Node 20+)
```

To try it on your phone, deploy to GitHub Pages (below), or tunnel your local server over HTTPS.

## Deploy

`.github/workflows/pages.yml` runs the tests and publishes the site to GitHub Pages on every push to `main`.
To turn it on, go to **Settings → Pages → Source: GitHub Actions**.

## Project layout

```
index.html            UI shell
styles.css
src/main.js           camera/video, render loop, UI, review mode
src/pose.js           MediaPipe Pose Landmarker loader and smoothing
src/geometry.js       landmark helpers, pixel → inch scale
src/swingDetector.js  state machine that finds address / top / impact / finish
src/metrics.js        per-checkpoint metrics and tour-pro reference ranges (tune here)
src/overlay.js        skeleton / head box / reference line drawing
src/coach.js          spoken feedback (Web Speech API)
src/clipAnalyzer.js   frame-by-frame pose sampling of a video file, slow-mo factor detection
src/clipEditor.js     edit plan (trim + pauses) and MP4 export via WebCodecs + mp4-muxer
src/cardCanvas.js     checkpoint card and captions drawn onto video frames
src/editorUI.js       the auto-edit screen
tests/                node:test unit tests
```

## Limitations

- Exporting video needs WebCodecs: Chrome or Edge, Safari 17+ (iOS 17+), or Firefox 130+. Audio is dropped from exported clips.

- These are coaching heuristics, not a launch monitor or a 3D motion-capture lab. The rotation numbers (shoulder turn, hip opening) come from a single camera's depth estimate and are marked **est.**
- At 30 fps the club moves a long way between frames, so the impact frame is approximate. Use 60 fps, or slow-motion video, for better results.
- The app assumes a face-on view. A down-the-line view would need a different set of metrics.
