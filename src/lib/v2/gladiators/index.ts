// FIX 2026-04-18 FAZA 3: Removed dead re-export of GladiatorRegistry.
// GladiatorRegistry is a duplicate of gladiatorStore.ts — never imported anywhere.
// gladiatorStore.ts is the canonical source. See gladiator-trainer agent docs.
// Original: export * from './gladiatorRegistry';
export {};
