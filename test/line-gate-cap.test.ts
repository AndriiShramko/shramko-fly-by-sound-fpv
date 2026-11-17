// Lane sonic5 W1.5 (design 5): in front of the next gate the racing line's look ends at the gate's approach point, so the
// hum does not run past the frame along the line's chord; it never lies behind the craft.
import { describe, expect, it } from 'vitest';
import { RacingLine } from '../src/cues/line';

describe('the racing line look stops at a cap (the next gate approach point)', () => {
    it('at 10 m/s the look is 10 m without a cap and 4 m with a cap 4 m ahead', () => {
        const line = new RacingLine([[0, 0, 0], [0, 0, -40]]);
        expect(line.update([0, 0, 0], 10).ahead[2]).toBeCloseTo(-10, 1);
        line.reset();
        expect(line.update([0, 0, 0], 10, 4).ahead[2]).toBeCloseTo(-4, 1);
    });
    it('a cap behind the craft keeps the point at the craft, never behind it', () => {
        const line = new RacingLine([[0, 0, 0], [0, 0, -40]]);
        expect(line.update([0, 0, -6], 10, 2).ahead[2]).toBeCloseTo(-6, 1);
    });
    it('a cap further than the look changes nothing', () => {
        const line = new RacingLine([[0, 0, 0], [0, 0, -40]]);
        expect(line.update([0, 0, 0], 5, 30).ahead[2]).toBeCloseTo(-5, 1);
    });
    it('placeOf gives the place along the line of a point beside it', () => {
        const line = new RacingLine([[0, 0, 0], [0, 0, -40]]);
        expect(line.placeOf([1, 0, -7])).toBeCloseTo(7, 1);
    });
});
