declare const process: {
  argv: string[];
  cwd(): string;
  exitCode?: number;
  stdin: any;
  stdout: { write(data: string): void };
};

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:child_process" {
  interface ChildProcessWithoutNullStreams {
    stdin: { write(data: string): void; end(): void };
    stdout: any;
    stderr: { on(event: "data", listener: (chunk: unknown) => void): void };
    on(event: "close", listener: (code: number | null) => void): void;
    once(event: "close", listener: (code: number | null) => void): void;
  }
  export function spawn(command: string, args?: string[], options?: Record<string, unknown>): ChildProcessWithoutNullStreams;
  export function spawnSync(command: string, args?: string[], options?: Record<string, unknown>): { status: number | null; stdout: string; stderr: string };
  export type { ChildProcessWithoutNullStreams };
}

declare module "node:readline" {
  export function createInterface(options: Record<string, unknown>): { on(event: "line", listener: (line: string) => void): void };
}

declare module "node:fs" {
  export function mkdirSync(path: string, options?: Record<string, unknown>): unknown;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: string): string;
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
  export function writeFileSync(path: string, data: string): void;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:test" {
  export function test(name: string, fn: () => void): void;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
