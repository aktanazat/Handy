/**
 * Ambient types for `bun:test` so `tsc` type-checks test files that run under
 * Bun (see package.json "test:scripts" and the bun test workflow). The Bun
 * runtime provides these at test time; the declaration only satisfies the
 * compiler, which never executes them.
 */
declare module "bun:test" {
  /* `not` carries the same matchers as the positive form, so it is one named
   * shape rather than a bag of unknowns. Typed as `Record<string, unknown>` it
   * compiled to "Object is of type 'unknown'" at every `.not.toContain(...)`,
   * which is the assertion a test reaches for to pin a defect dead. */
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toHaveLength(length: number): void;
    toBeGreaterThan(value: number): void;
    toBeLessThan(value: number): void;
    toMatch(regex: RegExp | string): void;
    toThrow(error?: unknown): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledWith(...args: unknown[]): void;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T = unknown>(value: T): Matchers & { not: Matchers };
}
