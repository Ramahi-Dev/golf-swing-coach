const KEY = 'swing-coach:settings:v1';

export const DEFAULT_SETTINGS = {
  hand: 'right', // 'right' | 'left'
  club: 'irons', // 'irons' | 'driver'
  facing: 'environment', // 'environment' (rear camera) | 'user' (selfie camera)
  model: 'full', // 'lite' | 'full' | 'heavy'
  voice: true,
  ball: null, // { x, y } normalized 0..1 in the video frame
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}
