/** Audio manager — uses Web Audio API to synthesize all sounds. Zero assets. */

let ctx: AudioContext | null = null;
let musicNode: { stop: () => void } | null = null;
let muted = false;

function getCtx(): AudioContext {
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

export function setMuted(m: boolean) {
  muted = m;
  if (m) {
    stopMusic();
  } else {
    startMusic();
  }
}

export function isMuted() {
  return muted;
}

/** quick white-noise burst */
function noiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * durationSec);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envGain(ctx: AudioContext, peak: number, attack: number, release: number) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  return { node: g, stopAt: t + attack + release + 0.05 };
}

export function playSwoosh() {
  if (muted) return;
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.4);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1200;
  filter.Q.value = 0.9;
  const env = envGain(c, 0.25, 0.01, 0.35);
  src.connect(filter).connect(env.node).connect(c.destination);
  src.start();
  src.stop(env.stopAt);
}

export function playNetSwish() {
  if (muted) return;
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.35);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 3500;
  filter.Q.value = 2.2;
  const env = envGain(c, 0.35, 0.005, 0.28);
  src.connect(filter).connect(env.node).connect(c.destination);
  src.start();
  src.stop(env.stopAt);
}

export function playRimClang() {
  if (muted) return;
  const c = getCtx();
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.value = 440;
  const osc2 = c.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.value = 880;
  const env = envGain(c, 0.28, 0.002, 0.25);
  osc.connect(env.node);
  osc2.connect(env.node);
  env.node.connect(c.destination);
  osc.start();
  osc2.start();
  osc.stop(env.stopAt);
  osc2.stop(env.stopAt);
}

export function playCheer() {
  if (muted) return;
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 1.4);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.6;
  const env = envGain(c, 0.22, 0.12, 1.2);
  src.connect(filter).connect(env.node).connect(c.destination);
  src.start();
  src.stop(env.stopAt);

  // add "yeah!" overtone
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(220, c.currentTime);
  osc.frequency.linearRampToValueAtTime(440, c.currentTime + 0.25);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.18, c.currentTime + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.6);
}

export function playBoo() {
  if (muted) return;
  const c = getCtx();
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, c.currentTime);
  osc.frequency.linearRampToValueAtTime(80, c.currentTime + 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.22, c.currentTime + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.75);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.85);
}

export function playTickTock() {
  if (muted) return;
  const c = getCtx();
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.value = 900;
  const env = envGain(c, 0.08, 0.001, 0.04);
  osc.connect(env.node).connect(c.destination);
  osc.start();
  osc.stop(env.stopAt);
}

export function playRelease() {
  if (muted) return;
  playSwoosh();
  try {
    navigator.vibrate?.(50);
  } catch {
    // ignore
  }
}

/** Simple 8-bar arcade loop. Very cheesy but kid-pleasing. */
export function startMusic() {
  if (muted || musicNode) return;
  const c = getCtx();
  const master = c.createGain();
  master.gain.value = 0.08;
  master.connect(c.destination);

  const bpm = 128;
  const beat = 60 / bpm;
  // simple 8-step bass pattern (C2, G2) and a melody on top
  const bass = [65.4, 65.4, 98, 65.4, 87.3, 65.4, 98, 73.4]; // C2 G2 F2 D2
  const melody = [523.25, 659.25, 783.99, 659.25, 587.33, 523.25, 659.25, 587.33]; // C5 E5 G5 E5 D5 C5 E5 D5

  let stopped = false;
  let step = 0;
  function schedule() {
    if (stopped) return;
    const t = c.currentTime;
    // bass
    const bOsc = c.createOscillator();
    bOsc.type = "triangle";
    bOsc.frequency.value = bass[step % bass.length];
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
    bOsc.connect(bg).connect(master);
    bOsc.start(t);
    bOsc.stop(t + beat);

    // melody (every other step)
    if (step % 2 === 0) {
      const mOsc = c.createOscillator();
      mOsc.type = "square";
      mOsc.frequency.value = melody[step % melody.length];
      const mg = c.createGain();
      mg.gain.setValueAtTime(0.0001, t);
      mg.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      mg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.45);
      mOsc.connect(mg).connect(master);
      mOsc.start(t);
      mOsc.stop(t + beat * 0.5);
    }

    // kick on beat 1 and 3
    if (step % 4 === 0 || step % 4 === 2) {
      const kOsc = c.createOscillator();
      kOsc.type = "sine";
      kOsc.frequency.setValueAtTime(120, t);
      kOsc.frequency.exponentialRampToValueAtTime(40, t + 0.14);
      const kg = c.createGain();
      kg.gain.setValueAtTime(0.9, t);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      kOsc.connect(kg).connect(master);
      kOsc.start(t);
      kOsc.stop(t + 0.2);
    }

    // hihat on offbeats
    if (step % 2 === 1) {
      const hSrc = c.createBufferSource();
      hSrc.buffer = noiseBuffer(c, 0.05);
      const hFilt = c.createBiquadFilter();
      hFilt.type = "highpass";
      hFilt.frequency.value = 6000;
      const hg = c.createGain();
      hg.gain.setValueAtTime(0.0001, t);
      hg.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
      hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      hSrc.connect(hFilt).connect(hg).connect(master);
      hSrc.start(t);
      hSrc.stop(t + 0.1);
    }

    step = (step + 1) % 32;
    setTimeout(schedule, beat * 1000);
  }
  schedule();
  musicNode = {
    stop() {
      stopped = true;
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.2);
    },
  };
}

export function stopMusic() {
  if (musicNode) {
    musicNode.stop();
    musicNode = null;
  }
}

/** User gesture primer — call from a click handler to unlock audio on iOS. */
export function primeAudio() {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0.0001;
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.01);
}
