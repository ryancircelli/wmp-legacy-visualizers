import { describe, expect, it } from 'vitest';
import { step } from './step';

describe('step', () => {
  it('holds a list at its ends', () => {
    expect(step(0, -1, 10)).toBe(0);
    expect(step(9, 1, 10)).toBe(9);
    expect(step(4, 1, 10)).toBe(5);
    expect(step(8, 4, 10)).toBe(9); // a jump past the end lands on the last
  });
  it('wraps the dial round', () => {
    expect(step(9, 1, 10, true)).toBe(0);
    expect(step(0, -1, 10, true)).toBe(9);
    expect(step(2, -13, 10, true)).toBe(9);
  });
  it('stays at 0 with nothing to move through', () => {
    expect(step(3, 1, 0)).toBe(0);
    expect(step(0, -1, 0, true)).toBe(0);
  });
});
