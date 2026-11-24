/**
 * Nachlauf-Scrollen („Schwung“): Nach dem Loslassen einer Verschiebe-Geste läuft die Ansicht mit der
 * zuletzt gemessenen Geschwindigkeit weiter und wird durch Reibung exponentiell abgebremst.
 *
 * Geschwindigkeiten in px/ms, Zeiten in ms (performance.now()).
 */

/** Anteil der Geschwindigkeit, der pro Millisekunde erhalten bleibt (0.9975 → Zeitkonstante ≈ 400 ms). */
export const FRICTION_PER_MS = 0.9975;
/** Darunter gilt die Bewegung als beendet. */
export const MIN_VELOCITY = 0.02;
/** Darunter startet gar kein Nachlauf (langsames, bewusstes Verschieben). */
export const START_VELOCITY = 0.12;
/** Obergrenze, damit ein zu schneller Wisch nicht durchs ganze Dokument schießt. */
export const MAX_VELOCITY = 6;
/** Zeitfenster der Geschwindigkeitsmessung vor dem Loslassen. */
export const SAMPLE_WINDOW_MS = 100;
/** Liegt die letzte Bewegung länger zurück, wurde der Finger vor dem Loslassen angehalten → kein Nachlauf. */
export const STALE_MS = 60;

export interface Vec {
  x: number;
  y: number;
}

/** Sammelt Scroll-Positionen während einer Geste und schätzt daraus die Geschwindigkeit beim Loslassen. */
export class VelocityTracker {
  private samples: { t: number; x: number; y: number }[] = [];

  reset() {
    this.samples = [];
  }

  add(t: number, x: number, y: number) {
    this.samples.push({ t, x, y });
    // Nur das Messfenster aufbewahren (plus ein Punkt davor als Referenz)
    while (this.samples.length > 2 && t - this.samples[1].t > SAMPLE_WINDOW_MS) this.samples.shift();
  }

  /** Geschwindigkeit der Scroll-Position zum Zeitpunkt `now` (px/ms). */
  velocity(now: number): Vec {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const last = s[s.length - 1];
    if (now - last.t > STALE_MS) return { x: 0, y: 0 };
    let first = s[0];
    for (const p of s) {
      if (last.t - p.t <= SAMPLE_WINDOW_MS) {
        first = p;
        break;
      }
    }
    const dt = last.t - first.t;
    if (dt < 8) return { x: 0, y: 0 };
    return clampVelocity({ x: (last.x - first.x) / dt, y: (last.y - first.y) / dt });
  }
}

export function clampVelocity(v: Vec): Vec {
  const speed = Math.hypot(v.x, v.y);
  if (speed <= MAX_VELOCITY) return v;
  const f = MAX_VELOCITY / speed;
  return { x: v.x * f, y: v.y * f };
}

export const shouldStart = (v: Vec) => Math.hypot(v.x, v.y) >= START_VELOCITY;

/**
 * Ein Zeitschritt: zurückgelegte Strecke (exakt integriert) und neue Geschwindigkeit.
 * v(t) = v0·f^t  →  Weg = v0·(f^dt − 1)/ln f
 */
export function step(v: Vec, dt: number, friction = FRICTION_PER_MS): { dx: number; dy: number; v: Vec } {
  const decay = Math.pow(friction, dt);
  const k = (decay - 1) / Math.log(friction);
  return { dx: v.x * k, dy: v.y * k, v: { x: v.x * decay, y: v.y * decay } };
}

/** Gesamtweg bis zum Stillstand (für Tests/Abschätzung): v0 · τ mit τ = −1/ln f. */
export const totalDistance = (v0: number, friction = FRICTION_PER_MS) => -v0 / Math.log(friction);

export const isDone = (v: Vec) => Math.hypot(v.x, v.y) < MIN_VELOCITY;

/**
 * Lässt ein Scroll-Element nachlaufen. `stop()` bricht sofort ab (neue Berührung, Zoom, Sprung zu Seite …).
 */
export class MomentumScroller {
  private raf = 0;
  private v: Vec = { x: 0, y: 0 };
  private last = 0;
  // Bruchteile von Pixeln sammeln, damit langsames Auslaufen nicht hängen bleibt
  private fx = 0;
  private fy = 0;

  constructor(
    private el: HTMLElement,
    private onEnd?: () => void,
  ) {}

  get running() {
    return this.raf !== 0;
  }

  start(v: Vec) {
    this.stop();
    if (!shouldStart(v)) return;
    this.v = clampVelocity(v);
    this.last = performance.now();
    this.fx = this.el.scrollLeft;
    this.fy = this.el.scrollTop;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onEnd?.();
  }

  private tick = (now: number) => {
    const dt = Math.min(64, Math.max(0, now - this.last));
    this.last = now;
    const s = step(this.v, dt);
    this.v = s.v;
    const el = this.el;
    // Wurde zwischendurch von außen gescrollt (Mausrad, Scrollbalken), dort weitermachen
    if (Math.abs(el.scrollLeft - this.fx) > 2) this.fx = el.scrollLeft;
    if (Math.abs(el.scrollTop - this.fy) > 2) this.fy = el.scrollTop;
    this.fx += s.dx;
    this.fy += s.dy;
    const beforeL = el.scrollLeft;
    const beforeT = el.scrollTop;
    el.scrollLeft = this.fx;
    el.scrollTop = this.fy;
    // Am Rand angekommen: Achse stoppen
    if (Math.abs(s.dx) >= 1 && el.scrollLeft === beforeL) this.v = { ...this.v, x: 0 };
    if (Math.abs(s.dy) >= 1 && el.scrollTop === beforeT) this.v = { ...this.v, y: 0 };
    this.fx = clampTo(this.fx, el.scrollLeft);
    this.fy = clampTo(this.fy, el.scrollTop);
    if (isDone(this.v)) {
      this.raf = 0;
      this.onEnd?.();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}

/** Gesammelte Position nicht weiter als 1 px von der tatsächlichen entfernen (Rand/Rundung). */
const clampTo = (f: number, actual: number) => Math.min(actual + 1, Math.max(actual - 1, f));
