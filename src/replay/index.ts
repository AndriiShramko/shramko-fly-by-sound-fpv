// The replay core (spec section 7, plan step 10): recorded frames and the world give re-derived events
// and cues; the comparer holds them to the recording with tolerances. DOM-free, so the report tool
// (Node) and the simulator's replay (browser) run the same code.
export * from './check';
export * from './compare';
export * from './frames';
export * from './rebuild';
export * from './replay';
