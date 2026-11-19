// The listener in every browser (simulator lane sound6 S4): Firefox has no AudioListener positionX..upZ, only setPosition and
// setOrientation. The engine wrote positionX.value there, the start threw and Firefox had no sound at all.
// The engine itself has DOM types (tsconfig.node.json has none), so it is loaded untyped for the one start test.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AudioContextLike } from '../src/contract';
import { placeListener, type ListenerLike } from '../src/audio/listener';

interface StartableEngine {
    start(ac: AudioContextLike): Promise<void>;
    readonly state: string;
}

/** A stand-in for any Web Audio object: every property is another one, every call returns another one, as a number it is 0. */
function anything(): unknown {
    const target = function () {
        return undefined;
    };
    const proxy: unknown = new Proxy(target, {
        get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : key === 'then' ? undefined : proxy),
        set: () => true,
        apply: () => proxy
    });
    return proxy;
}

/** A context as Firefox gives it, as far as the listener goes: only the older setters. */
function firefoxLikeContext(): { ctx: AudioContextLike; calls: string[] } {
    const calls: string[] = [];
    const listener: ListenerLike = {
        setPosition: (...a: number[]) => void calls.push(`setPosition(${a.join(',')})`),
        setOrientation: (...a: number[]) => void calls.push(`setOrientation(${a.join(',')})`)
    };
    const own: Record<string | symbol, unknown> = { currentTime: 0, sampleRate: 48000, state: 'running', listener };
    const ctx = new Proxy(own, { get: (o, key) => (key in o ? o[key] : key === 'then' ? undefined : anything()) }) as unknown as AudioContextLike;
    return { ctx, calls };
}

async function newEngine(): Promise<StartableEngine> {
    const path = '../src/audio/engine';
    const m = (await import(/* @vite-ignore */ path)) as { createSonicEngine(o: { pump: boolean }): StartableEngine };
    return m.createSonicEngine({ pump: false });
}

const param = (): { value: number } => ({ value: 7 });

describe('placeListener: the listener at the origin, facing -Z, +Y up, in every browser', () => {
    it('Chrome, Edge, Safari: the AudioParams are set', () => {
        const l = { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() };
        expect(placeListener(l)).toBe('params');
        expect([l.positionX, l.positionY, l.positionZ, l.forwardX, l.forwardY, l.forwardZ, l.upX, l.upY, l.upZ].map((p) => p.value)).toEqual([0, 0, 0, 0, 0, -1, 0, 1, 0]);
    });

    it('Firefox: no AudioParams, the older setters are called once each with the same pose', () => {
        const calls: string[] = [];
        const l: ListenerLike = { setPosition: (...a: number[]) => void calls.push(`p ${a.join(',')}`), setOrientation: (...a: number[]) => void calls.push(`o ${a.join(',')}`) };
        expect(placeListener(l)).toBe('setters');
        expect(calls).toEqual(['p 0,0,0', 'o 0,0,-1,0,1,0']);
    });

    it('a listener with neither keeps its default pose (the same one) and nothing throws', () => {
        expect(placeListener({})).toBe('default');
    });

    it('engine.start on a context whose listener has only setPosition and setOrientation resolves and runs', async () => {
        const { ctx, calls } = firefoxLikeContext();
        const engine = await newEngine();
        await expect(engine.start(ctx)).resolves.toBeUndefined();
        expect(engine.state).toBe('running');
        expect(calls.filter((c) => c.startsWith('setOrientation'))).toEqual(['setOrientation(0,0,-1,0,1,0)']);
        expect(calls.filter((c) => c.startsWith('setPosition'))).toEqual(['setPosition(0,0,0)']);
    });

    it('the engine sets the listener only through placeListener', () => {
        const src = readFileSync(new URL('../src/audio/engine.ts', import.meta.url), 'utf8');
        expect(src).toContain('placeListener(ctx.listener)');
        expect(src).not.toMatch(/listener\.(position|forward|up)[XYZ]/);
    });
});
