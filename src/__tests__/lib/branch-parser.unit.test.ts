import { describe, it, expect } from 'vitest';
import { parseBranchArg } from '../../lib/branch-parser.js';

describe('parseBranchArg', () => {
  it('should detect PR from numeric string', () => {
    const result = parseBranchArg('1234');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('1234');
  });

  it('should detect branch from alphanumeric name', () => {
    const result = parseBranchArg('cool-feature');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('cool-feature');
  });

  it('should accept branch names with slashes', () => {
    const result = parseBranchArg('fix/bug-123');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('fix/bug-123');
  });

  it('should reject old feature/ prefix', () => {
    expect(() => parseBranchArg('feature/cool')).toThrow();
  });

  it('should reject old bug/ prefix', () => {
    expect(() => parseBranchArg('bug/fix')).toThrow();
  });

  it('should reject old pr/ prefix', () => {
    expect(() => parseBranchArg('pr/1234')).toThrow();
  });

  it('should reject invalid characters', () => {
    expect(() => parseBranchArg('invalid branch!')).toThrow();
  });
});
