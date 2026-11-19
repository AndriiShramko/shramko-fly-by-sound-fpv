// The Web Audio listener's pose, set the same way in every browser (simulator lane sound6 S4). No DOM types here, so the
// Node tests check it.

/** One coordinate of the listener as an AudioParam. */
interface ListenerParam {
    value: number;
}

/**
 * The context's listener as the browsers give it: Chrome, Edge and Safari have the AudioParams positionX to upZ, Firefox has
 * only the older setPosition and setOrientation (simulator lane sound6 S4: writing positionX.value there threw, the engine
 * did not start and Firefox had no sound).
 */
export interface ListenerLike {
    readonly positionX?: ListenerParam;
    readonly positionY?: ListenerParam;
    readonly positionZ?: ListenerParam;
    readonly forwardX?: ListenerParam;
    readonly forwardY?: ListenerParam;
    readonly forwardZ?: ListenerParam;
    readonly upX?: ListenerParam;
    readonly upY?: ListenerParam;
    readonly upZ?: ListenerParam;
    setPosition?(x: number, y: number, z: number): void;
    setOrientation?(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
}

/** How placeListener set the listener: its AudioParams, the older setters, or nothing to set (the default pose is the same). */
export type ListenerPlacement = 'params' | 'setters' | 'default';

/**
 * Puts the listener at the origin facing -Z with +Y up (Web Audio's default pose, set so that no browser keeps another). The
 * listener never moves: the panners carry the heading frame.
 */
export function placeListener(l: ListenerLike): ListenerPlacement {
    const { positionX, positionY, positionZ, forwardX, forwardY, forwardZ, upX, upY, upZ } = l;
    if (positionX && positionY && positionZ && forwardX && forwardY && forwardZ && upX && upY && upZ) {
        positionX.value = 0;
        positionY.value = 0;
        positionZ.value = 0;
        forwardX.value = 0;
        forwardY.value = 0;
        forwardZ.value = -1;
        upX.value = 0;
        upY.value = 1;
        upZ.value = 0;
        return 'params';
    }
    if (l.setPosition === undefined && l.setOrientation === undefined) return 'default';
    l.setPosition?.(0, 0, 0);
    l.setOrientation?.(0, 0, -1, 0, 1, 0);
    return 'setters';
}
