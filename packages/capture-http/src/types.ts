import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';

export interface CaptureRedactionPolicy {
  readonly headers: readonly string[];
  readonly jsonPaths: readonly string[];
}

export type CapturedScenarioRedaction = NonNullable<ScenarioV1['provenance']['redaction']>;

export interface SanitizedCaptureDraft {
  readonly preview: string;
  readonly redaction: CapturedScenarioRedaction;
  readonly scenario: ScenarioV1;
}

export interface PersistSanitizedCaptureOptions {
  readonly outputDirectory: string;
  readonly signal?: AbortSignal;
}

export interface PersistedSanitizedCapture {
  readonly path: string;
  readonly scenario: ScenarioV1;
}
