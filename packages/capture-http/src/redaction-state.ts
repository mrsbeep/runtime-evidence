import type { CapturedScenarioRedaction } from './types.ts';

export interface RedactionState {
  readonly rules: Set<string>;
  valuesRemoved: number;
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createRedactionState(): RedactionState {
  return { rules: new Set<string>(), valuesRemoved: 0 };
}

export function recordRedaction(state: RedactionState, rule: string, count = 1): void {
  state.rules.add(rule);
  state.valuesRemoved += count;
}

export function redactionMetadata(state: RedactionState): CapturedScenarioRedaction {
  return {
    applied: true,
    rules: [...state.rules].sort(compareCodeUnits),
    valuesRemoved: state.valuesRemoved,
  };
}
