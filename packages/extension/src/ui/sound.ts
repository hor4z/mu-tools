/**
 * Aviso sonoro de una joya o un excelente que cayó cerca. Un solo AudioContext para toda la página: crear uno por aviso (como antes) los iba
 * acumulando sin cerrarlos, y Chrome degrada el audio y la página. Se crea con un click del usuario (la campanita), que es lo que el navegador
 * pide para dejar sonar.
 */
let ctx: AudioContext | null = null;

/** Prepara el audio; llamarlo desde un click. */
export function unlockSound() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* sin audio */ }
}

/** Dos notas cortas y suaves. */
export function chime() {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  for (const [freq, at] of [[880, 0], [1320, 0.12]] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.06, t0 + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.26);
  }
}
