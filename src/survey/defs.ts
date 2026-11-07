// The spoken surveys of spec section 9, as data: first flight, returning pilot, and a child
// variant built on the Again-Again table. All texts are keys of locales/<lang>.json.
//
// Every scale is answered with ONE key press: 1 to 5, or 0 to 9 for the workload questions (an
// unweighted NASA-TLX with a ten-level scale instead of 0 to 10, because "10" needs two keys; the
// answer converts to 0 to 100 as value * 100 / 9). Choices are answered with 1, 2, 3 in the order
// read; open questions are answered by voice into the recording; any question can be skipped.
import { FORMATS, type SpeechLine, type SurveyDef, type SurveyItem } from '../contract';

const line = (key: string): SpeechLine => ({ key });
const item = (id: string): SpeechLine => line(`survey.item.${id}`);
const anchor = (name: string): SpeechLine => line(`survey.anchor.${name}`);
const option = (name: string): SpeechLine => line(`survey.opt.${name}`);

function scale(id: string, min: number, max: number, low: string, high: string): SurveyItem {
    return { id, kind: 'scale', prompt: item(id), min, max, anchors: [anchor(low), anchor(high)] };
}

function choice(id: string, ...options: string[]): SurveyItem {
    return { id, kind: 'choice', prompt: item(id), options: options.map(option) };
}

function open(id: string, maxSeconds = 30): SurveyItem {
    return { id, kind: 'open', prompt: item(id), maxSeconds };
}

export const SURVEY_FIRST: SurveyDef = {
    format: FORMATS.survey,
    id: 'first-flight',
    version: 1,
    variant: 'first',
    items: [
        scale('fun', 1, 5, 'not-at-all', 'a-lot'),
        scale('mental', 0, 9, 'very-easy', 'very-hard'),
        scale('frustration', 0, 9, 'not-annoyed', 'very-annoyed'),
        scale('fear', 0, 9, 'not-afraid', 'very-afraid'),
        choice('up-direction', 'higher', 'lower', 'no-idea'),
        choice('ears-tired', 'no', 'a-little', 'yes'),
        open('helped'),
        open('annoyed'),
        choice('again', 'yes', 'maybe', 'no')
    ]
};

export const SURVEY_RETURNING: SurveyDef = {
    format: FORMATS.survey,
    id: 'returning-pilot',
    version: 1,
    variant: 'returning',
    items: [
        scale('mental', 0, 9, 'very-easy', 'very-hard'),
        scale('temporal', 0, 9, 'relaxed', 'rushed'),
        scale('performance', 0, 9, 'failed', 'perfect'),
        scale('effort', 0, 9, 'no-effort', 'huge-effort'),
        scale('frustration', 0, 9, 'not-annoyed', 'very-annoyed'),
        scale('learned-quickly', 1, 5, 'disagree', 'agree'),
        scale('confident', 1, 5, 'disagree', 'agree'),
        choice('came-back', 'yes', 'no'),
        open('turned-off'),
        open('change')
    ]
};

export const SURVEY_CHILD: SurveyDef = {
    format: FORMATS.survey,
    id: 'child-again-again',
    version: 1,
    variant: 'child',
    items: [
        scale('child-fun', 1, 5, 'boring', 'brilliant'),
        choice('child-again-flying', 'yes', 'maybe', 'no'),
        choice('child-again-walls', 'yes', 'maybe', 'no'),
        choice('child-again-rings', 'yes', 'maybe', 'no'),
        choice('child-scary', 'no', 'a-bit', 'yes'),
        open('child-liked-best')
    ]
};

export const SURVEYS: readonly SurveyDef[] = [SURVEY_FIRST, SURVEY_RETURNING, SURVEY_CHILD];

/** Every locale key the survey definitions use, in order of first use, without repeats. */
export function surveyKeys(): string[] {
    const seen = new Set<string>();
    const add = (l: SpeechLine): void => {
        seen.add(l.key);
    };
    for (const survey of SURVEYS) {
        for (const it of survey.items) {
            add(it.prompt);
            if (it.kind === 'scale') it.anchors.forEach(add);
            else if (it.kind === 'choice') it.options.forEach(add);
        }
    }
    return [...seen];
}
