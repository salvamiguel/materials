// Minimal types for Bun's test runner, so the site's tsconfig can check the
// engine tests without pulling @types/bun's globals into the Docusaurus build.
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>, timeout?: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function expect(value: unknown): any;
}
