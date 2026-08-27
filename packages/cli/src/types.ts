export const CliCommandNames = ['capture', 'doctor', 'init', 'report', 'schema', 'verify'] as const;

export type CliCommandName = (typeof CliCommandNames)[number];
export type CliStatus =
  | 'behavioral-failure'
  | 'incomplete'
  | 'infrastructure-failure'
  | 'invalid-input'
  | 'success';

export interface CliDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface CliCommandResult {
  readonly code: string;
  readonly data?: unknown;
  readonly diagnostics?: readonly CliDiagnostic[];
  readonly humanOutput?: string;
  readonly message: string;
  readonly status: CliStatus;
}

export type CliOptionValue = boolean | readonly string[] | string | undefined;
export type CliOptions = Readonly<Record<string, CliOptionValue>>;

export interface CliCommandContext {
  readonly command: CliCommandName;
  readonly cwd: string;
  readonly json: boolean;
  readonly options: CliOptions;
  readonly progress: (message: string) => void;
  readonly signal: AbortSignal;
}

export type CliCommandHandler = (
  context: CliCommandContext,
) => CliCommandResult | Promise<CliCommandResult>;

export interface CliIo {
  readonly stderr: (text: string) => void;
  readonly stdout: (text: string) => void;
}

export interface CliRunOptions {
  readonly cwd?: string;
  readonly handlers?: Readonly<Partial<Record<CliCommandName, CliCommandHandler>>>;
  readonly io?: CliIo;
  readonly signal?: AbortSignal;
}

export interface CliOutputEnvelope {
  readonly code: string;
  readonly command: CliCommandName | null;
  readonly data?: unknown;
  readonly diagnostics: readonly CliDiagnostic[];
  readonly exitCode: CliExitCode;
  readonly message: string;
  readonly schemaVersion: 1;
  readonly status: CliStatus;
}

export type CliExitCode = 0 | 1 | 2 | 3 | 4;

export interface CliRunResult {
  readonly envelope: CliOutputEnvelope;
  readonly exitCode: CliExitCode;
}
