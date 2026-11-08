// Spoken feedback via the Web Speech API.

export class Coach {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /** iOS only lets pages speak after a user gesture; call this from a click handler. */
  unlock() {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  say(text) {
    if (!this.enabled || !this.supported || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on && this.supported) speechSynthesis.cancel();
  }
}
