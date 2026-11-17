// Design 4 (simulator lane sonic5 W1.4): the brake cue and the ear pilot's matching rule.
import { describe, expect, it } from 'vitest';
import { brakeNeeded, brakeRangeM, BRAKE_MIN_MPS } from '../src/cues/brake';
import { EarPilot } from '../src/pilot/ear-pilot';

describe('brake cue', () => {
    it('asks to brake for a hum aside and near at speed', () => {
        // 8 m/s along -z; the hum 4 m to the right and 1 m ahead: 76 deg aside, nearer than the range
        expect(brakeRangeM(8)).toBeGreaterThan(8);
        expect(brakeNeeded([4, 0, -1], [0, 0, -8])).toBe(true);
    });
    it('stays quiet for a hum ahead, a hum far away, or a slow craft', () => {
        expect(brakeNeeded([1, 0, -6], [0, 0, -8])).toBe(false);
        expect(brakeNeeded([40, 0, -1], [0, 0, -8])).toBe(false);
        expect(brakeNeeded([4, 0, -1], [0, 0, -(BRAKE_MIN_MPS - 0.5)])).toBe(false);
    });
    it('the ear pilot slows down while it hears the brake cue', () => {
        const pilot = new EarPilot({ speedMps: 8, reactionMs: 0 });
        const plain = pilot.step({ t: 0, urgent: false, streams: [] });
        const braking = pilot.step({ t: 10, urgent: false, streams: [], brake: true });
        expect(plain.forwardMps).toBe(8);
        expect(braking.forwardMps).toBeLessThan(4);
    });
});
