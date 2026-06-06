declare const process: {
  cwd(): string;
};

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:fs" {
  export function copyFileSync(source: string, destination: string): void;
  export function existsSync(path: string): boolean;
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options?: Record<string, unknown>): unknown;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: string): string;
  export function rmSync(path: string, options?: Record<string, unknown>): void;
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
  export function writeFileSync(path: string, data: string): void;
}

declare module "node:os" {
  export function cpus(): unknown[];
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(path: string): string;
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
  export function pathToFileURL(path: string): URL;
}
