// The height layer (v0.13, M41-12, the owner's message 41): two tones.
//
//   the height tone   glides continuously with the craft's height above the lesson floor, one scale step
//                     per `metresPerStep`, never rounded to a note (v0.12 rounded it, and the owner heard
//                     jumps and could not tell where he was between them)
//   the target note   a short note at the TARGET height's pitch, about once a second: the next gate's
//                     centre in a ring or gate lesson, else the centre of the lesson's band; null when
//                     there is none. While it sounds the height tone gives way to it (the engine), so the
//                     two never sound together
//
// Both come from one mapping, so at the target height the note is the height tone's own pitch exactly:
// the tone goes on at the same pitch through the note. Off the target the note is higher or lower than
// the tone around it. Up-higher: the height tone under the target note means "climb" (up-lower turns
// both over, so the craft's tone over the target's means climb). The first design (review M2) held the
// target as a second, steady tone 6 dB under the height tone: the pair beat at 7 to 62 Hz over most of a
// hover lesson's band, as rough as the out-of-band buzz ("too high or too low") and, near the target, at
// the 2 to 7 Hz wobble of the target hum ("off to one side"). One tone at a time has no beat at all, so
// the buzz and the hum keep their meanings. The mapping is moved, once per lesson world, by less than half a step so that the lesson's
// reference height (its first gate, else its band centre) lands on a note: then the target tone is a
// note of the scale for every target on that 0.5 m grid (shipped themes: 0.5 m per step); a target off
// the grid keeps its exact unison and is reported as off the scale (`onScale` false).
//
// Pure: the planner calls it every frame, the engine renders it, the replay re-derives it.
import type { LessonLayers, ObjectShape, SonicObject, SonicPrefs, SonicWorld, ThemeDef, Vec3 } from '../contract';
import { heightPosition, noteHz, noteHzAt, scaleSize, type HeightMapping } from '../theme/pitch';
import { bandRoughness, clamp } from './rules';

/** The objects whose centre is a height to fly through: the gates. */
const GATE_KINDS: ReadonlySet<ObjectShape['kind']> = new Set(['ring', 'square', 'cube-frame']);

/** A gate of the course: an object with a place in the course and an opening. */
export function isGate(o: Pick<SonicObject, 'order' | 'shape'>): boolean {
    return o.order !== null && GATE_KINDS.has(o.shape.kind);
}

/** The centre of a lesson's height band, metres above the floor, or null. */
export function bandCentreM(band: LessonLayers['heightBandM']): number | null {
    return band === null ? null : (band[0] + band[1]) / 2;
}

/**
 * The lesson's reference height, metres above the floor: the first gate of the world (lowest order),
 * else the band centre, else null. The mapping is aligned on it (alignOffset).
 */
export function referenceHeightM(world: Pick<SonicWorld, 'objects'> | null, band: LessonLayers['heightBandM'], floorY: number): number | null {
    let first: SonicObject | null = null;
    if (world !== null) {
        for (const o of world.objects()) if (isGate(o) && (first === null || (o.order as number) < (first.order as number))) first = o;
    }
    if (first !== null) return first.pos[1] - floorY;
    return bandCentreM(band);
}

/** The offset of the mapping, scale steps in [-0.5, 0.5], that puts `refM` on a whole step; 0 without a reference. */
export function alignOffset(refM: number | null, metresPerStep: number): number {
    if (refM === null || !Number.isFinite(refM) || !(metresPerStep > 0)) return 0;
    const s = refM / metresPerStep;
    return Math.round(s) - s;
}

/** The target height now, metres above the floor: the target if it is a gate, else the band centre, else null. */
export function targetHeightM(target: SonicObject | null, band: LessonLayers['heightBandM'], floorY: number): number | null {
    if (target !== null && isGate(target)) return target.pos[1] - floorY;
    return bandCentreM(band);
}

export interface HeightToneRule {
    readonly baseStep: number;
    readonly maxStep: number;
    readonly metresPerStep: number;
    readonly roughDepth: number;
    readonly bandSoftM: number;
    /** level of the target note against the height tone, dB */
    readonly targetDb: number;
    /** time between two target notes, s */
    readonly targetPeriodS: number;
    /** length of a target note, s (the height tone gives way to it meanwhile) */
    readonly targetNoteS: number;
}

export interface TargetTone {
    /** metres above the floor */
    readonly heightM: number;
    /** position on the scale (a whole note when onScale) */
    readonly position: number;
    readonly hz: number;
    /** the whole note it is, or null when the target lies off the lesson's grid */
    readonly noteIndex: number | null;
    readonly onScale: boolean;
    /** against the height tone, dB */
    readonly gainDb: number;
    /** a note every periodS, noteS long; the height tone gives way to it meanwhile */
    readonly periodS: number;
    readonly noteS: number;
    /**
     * Lane s13-elev (SonicPrefs.heightDirection on): where the note comes from, listener frame (the gate's centre, or the
     * band's middle a little ahead); absent: no direction, straight into the height bus (v0.13)
     */
    readonly dir?: Vec3;
    /** Lane s13-elev: the breath of air with the note, dB against its fundamental (the planner's airDb); absent: none */
    readonly airDb?: number;
}

export interface HeightTones {
    readonly heightM: number;
    /** position on the scale of the height tone (a note index with a fraction) */
    readonly position: number;
    readonly hz: number;
    /** roughness outside the lesson's band, 0 inside */
    readonly rough: number;
    readonly target: TargetTone | null;
}

/** Whole positions are snapped within this, so a target on the grid is a note exactly (float noise of the division). */
const SNAP = 1e-6;

/**
 * Both tones for a height, a target height (or null), the lesson's band and the mapping's alignment.
 * `pitchSteps` is the pilot's own shift of the height layer, whole scale steps, applied to both tones.
 */
export function heightTones(
    heightM: number,
    targetM: number | null,
    band: LessonLayers['heightBandM'],
    rule: HeightToneRule,
    scale: ThemeDef['scale'],
    polarity: SonicPrefs['heightPolarity'],
    offsetSteps: number,
    pitchSteps = 0
): HeightTones {
    const map: HeightMapping = { baseStep: rule.baseStep, maxStep: rule.maxStep, metresPerStep: rule.metresPerStep, polarity };
    const top = scaleSize(scale) - 1;
    const shift = Number.isFinite(pitchSteps) ? Math.round(pitchSteps) : 0;
    const place = (h: number): number => clamp(heightPosition(h, map, offsetSteps) + shift, 0, top);
    const position = place(heightM);
    let target: TargetTone | null = null;
    if (targetM !== null && Number.isFinite(targetM)) {
        const raw = place(targetM);
        const whole = Math.round(raw);
        const onScale = Math.abs(raw - whole) <= SNAP;
        target = { heightM: targetM, position: onScale ? whole : raw, hz: onScale ? noteHz(scale, whole) : noteHzAt(scale, raw), noteIndex: onScale ? whole : null, onScale, gainDb: rule.targetDb, periodS: rule.targetPeriodS, noteS: rule.targetNoteS };
    }
    // the height tone at the target's own height is the target tone exactly (one mapping, one snap)
    const atTarget = target !== null && Math.abs(position - target.position) <= SNAP;
    return {
        heightM,
        position: atTarget ? (target as TargetTone).position : position,
        hz: atTarget ? (target as TargetTone).hz : noteHzAt(scale, position),
        rough: bandRoughness(heightM, band, rule.roughDepth, rule.bandSoftM),
        target
    };
}

/** Cents from `b` to `a` (positive: a is higher). */
export function centsBetween(a: number, b: number): number {
    return 1200 * Math.log2(a / b);
}
