/**
 * Signal Alignment sub-engine — pure functions for computing the 6 signals
 * defined in PRD §10.4 + blueprint §4.5. Independent from the composite
 * score (blueprint §4 category model). Implementation lands at Phase C
 * Step 7.5; this stub exists at Step 1 only so import sites type-check
 * once Step 7.5 begins.
 */

import { SIGNAL_RULES_VERSION } from "./weights";

export type SignalName =
  | "EXTREME_FEAR"
  | "DISLOCATION"
  | "ECONOMY_INTACT"
  | "SPREAD_REVERSAL"
  | "LIQUIDITY_EASING"
  | "MOMENTUM_TURN";

export const ALL_SIGNALS: readonly SignalName[] = [
  "EXTREME_FEAR",
  "DISLOCATION",
  "ECONOMY_INTACT",
  "SPREAD_REVERSAL",
  "LIQUIDITY_EASING",
  "MOMENTUM_TURN",
];

/**
 * Per-signal evaluation detail. Populated by Step 7.5's `computeSignals`.
 * `state` semantics:
 *   "active"   — inputs present, threshold condition met
 *   "inactive" — inputs present, threshold not met
 *   "unknown"  — at least one input missing (blueprint §4.5 null policy)
 */
export type SignalState = "active" | "inactive" | "unknown";

export type SignalDetail = {
  state: SignalState;
  // Step 7.5 fills in inputs, threshold, formula for UI tooltip.
};

export type SignalComputation = {
  active: SignalName[];
  unknown: SignalName[];
  perSignal: Record<SignalName, SignalDetail>;
  signalRulesVersion: typeof SIGNAL_RULES_VERSION;
};

// Step 7.5 will implement computeSignals(inputs).
// Step 1 stub exports the type surface only so downstream readers
// (src/lib/data/signals.ts) can be stubbed in early if needed.
