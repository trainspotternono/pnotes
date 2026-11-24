import { describe, expect, it } from 'vitest';
import { FRICTION_PER_MS, MAX_VELOCITY, isDone, shouldStart, step, totalDistance, VelocityTracker } from './momentum';
import { stylusModeOf } from '../tools/inputRouting';

describe('Nachlauf-Scrollen', () => {
  it('misst die Geschwindigkeit eines Wischs (px/ms)', () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 10; i++) v.add(1000 + i * 10, 0, i * 20); // 20 px je 10 ms = 2 px/ms
    const vel = v.velocity(1105);
    expect(vel.x).toBe(0);
    expect(vel.y).toBeCloseTo(2, 5);
    expect(shouldStart(vel)).toBe(true);
  });

  it('kein Nachlauf, wenn der Finger vor dem Loslassen angehalten wurde', () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 10; i++) v.add(1000 + i * 10, 0, i * 20);
    expect(shouldStart(v.velocity(1300))).toBe(false);
  });

  it('kein Nachlauf bei langsamem Verschieben', () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 10; i++) v.add(i * 10, 0, i * 0.5);
    expect(shouldStart(v.velocity(100))).toBe(false);
  });

  it('begrenzt zu schnelle Wische', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(20, 0, 2000);
    expect(Math.hypot(v.velocity(20).x, v.velocity(20).y)).toBeCloseTo(MAX_VELOCITY, 5);
  });

  it('bremst ab und kommt zum Stillstand, Weg entspricht der Formel', () => {
    let vel = { x: 0, y: 2 };
    let dist = 0;
    let t = 0;
    while (!isDone(vel) && t < 10_000) {
      const s = step(vel, 16);
      dist += s.dy;
      vel = s.v;
      t += 16;
    }
    expect(isDone(vel)).toBe(true);
    expect(t).toBeLessThan(3000); // hält in unter 3 s an
    expect(dist).toBeGreaterThan(totalDistance(2) * 0.95);
    expect(dist).toBeLessThan(totalDistance(2));
    expect(totalDistance(2)).toBeCloseTo(-2 / Math.log(FRICTION_PER_MS), 6);
  });

  it('Schrittweite beeinflusst den Weg nicht (exakte Integration)', () => {
    const a = step({ x: 1, y: 0 }, 32);
    const b1 = step({ x: 1, y: 0 }, 16);
    const b2 = step(b1.v, 16);
    expect(a.dx).toBeCloseTo(b1.dx + b2.dx, 9);
  });
});

describe('Stift-Knöpfe', () => {
  it('Radiertaste/Radierer-Ende und Seitentaste werden erkannt', () => {
    expect(stylusModeOf({ pointerType: 'pen', button: 5, buttons: 32 })).toBe('eraser');
    expect(stylusModeOf({ pointerType: 'pen', button: -1, buttons: 32 })).toBe('eraser');
    expect(stylusModeOf({ pointerType: 'pen', button: 2, buttons: 2 })).toBe('barrel');
    expect(stylusModeOf({ pointerType: 'pen', button: 0, buttons: 1 })).toBe(null);
    expect(stylusModeOf({ pointerType: 'mouse', button: 2, buttons: 2 })).toBe(null);
  });
});
