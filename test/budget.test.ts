// The stream budget at speed (sonic3 plan 2.2, stage Z4): the tier table with its hysteresis and hold, at most the
// tier's stream count, the priority (urgent hazard, guide, open-way chime, other hazards), the chime replacing the
// hazards at tier 2, previews never cut, tier 0 unchanged. Not yet wired into the planner (see docs of the lane).
import { describe, expect, it } from 'vitest';
import { applyBudget, layerPlanOn, streamRank, TIER_HOLD_MS, TIER_STREAMS, TierGate, type SpeedTier, type StreamRequest } from '../src/cues/budget';

const req = (key: string, cue: string, priority: number): StreamRequest => ({ key, cue, priority });
const FRAME: readonly StreamRequest[] = [
    req('safety:front', 'safety.obstacle', 100),
    req('safety:left', 'safety.wall', 99),
    req('safety:right', 'safety.wall', 98),
    req('free:right', 'safety.free', 90),
    req('target', 'target.hum', 80),
    req('shape', 'shape.trace', 60),
    req('preview:1', 'safety.wall', 70)
];
const keys = (tier: SpeedTier, urgent: readonly string[] = [], frame: readonly StreamRequest[] = FRAME): string[] =>
    applyBudget(frame, tier, new Set(urgent)).kept.map((r) => r.key);

describe('speed tiers', () => {
    it('steps up at 4.5, 8 and 15 m/s and holds a tier at least the hold time', () => {
        const g = new TierGate();
        expect(g.update(4.4, 0)).toBe(0);
        expect(g.update(4.5, 1000)).toBe(1);
        expect(g.update(9, 1000 + TIER_HOLD_MS - 1)).toBe(1);
        expect(g.update(9, 1000 + TIER_HOLD_MS)).toBe(2);
        expect(g.update(16, 3000)).toBe(3);
    });

    it('steps down only below 85 % of the edge (no flicker at the edge)', () => {
        const g = new TierGate();
        g.update(8.2, 0);
        expect(g.tier).toBe(2);
        let changes = 0;
        let last = g.tier;
        for (let i = 1; i <= 100; i++) {
            const tier = g.update(i % 2 === 0 ? 7.9 : 8.1, i * 600);
            if (tier !== last) changes++;
            last = tier;
        }
        expect(changes).toBe(0);
        expect(g.update(6.7, 100_000)).toBe(1);
        expect(g.update(2.5, 101_000)).toBe(0);
    });
});

describe('streams at a tier', () => {
    it('tier 0 keeps every stream as before', () => {
        expect(keys(0)).toEqual(FRAME.map((r) => r.key));
    });

    it('never keeps more continuous streams than the tier allows; previews are not streams', () => {
        for (const tier of [1, 2, 3] as const) {
            const kept = applyBudget(FRAME, tier, new Set()).kept.filter((r) => streamRank(r, new Set()) !== null);
            expect(kept.length, `tier ${tier}`).toBeLessThanOrEqual(TIER_STREAMS[tier]);
            expect(keys(tier), `tier ${tier}`).toContain('preview:1');
        }
    });

    it('tier 1: the guide, the open-way chime and the urgent hazard; no shape trace', () => {
        expect(keys(1, ['safety:left'])).toEqual(['safety:left', 'free:right', 'target', 'preview:1']);
        expect(keys(1)).not.toContain('shape');
    });

    it('tier 2: the guide is always kept, and the open-way chime replaces the hazards', () => {
        expect(keys(2, ['safety:front'])).toEqual(['free:right', 'target', 'preview:1']);
        const noFree = FRAME.filter((r) => r.cue !== 'safety.free');
        expect(keys(2, ['safety:front'], noFree)).toEqual(['safety:front', 'target', 'preview:1']);
        expect(keys(2, [], noFree)).toEqual(['safety:front', 'target', 'preview:1']);
    });

    it('speed ticks and the height tone stop at tier 2 and up', () => {
        expect([0, 1, 2, 3].map((t) => layerPlanOn(t as SpeedTier))).toEqual([true, true, false, false]);
    });
});
