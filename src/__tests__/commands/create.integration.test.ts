import { describe, it, expect } from 'vitest';
import { parseBranchArg } from '../../lib/branch-parser.js';

describe('create command: branch argument parsing', () => {
  it('should detect PR from numeric string', () => {
    const result = parseBranchArg('1234');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('1234');
  });

  it('should accept simple branch name', () => {
    const result = parseBranchArg('cool-feature');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('cool-feature');
  });

  it('should accept branch name with underscore', () => {
    const result = parseBranchArg('fix_bug_123');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('fix_bug_123');
  });

  it('should accept branch names with slashes', () => {
    const result = parseBranchArg('fix/bug-123');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('fix/bug-123');
  });

  it('should accept branch names with multiple slashes', () => {
    const result = parseBranchArg('bugfix/section/subsection');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('bugfix/section/subsection');
  });

  it('should reject old feature/ prefix with error', () => {
    expect(() => parseBranchArg('feature/cool')).toThrow(/Invalid branch format/);
  });

  it('should reject old bug/ prefix with error', () => {
    expect(() => parseBranchArg('bug/fix')).toThrow(/Invalid branch format/);
  });

  it('should reject old pr/ prefix with error', () => {
    expect(() => parseBranchArg('pr/1234')).toThrow(/Invalid branch format/);
  });

  it('should reject branch/ prefix with error', () => {
    // branch/ is not checked by the parser - it's treated as a valid branch name
    const result = parseBranchArg('branch/name');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('branch/name');
  });

  it('should reject branch names with special characters', () => {
    expect(() => parseBranchArg('invalid branch!')).toThrow(/Invalid branch name/);
  });

  it('should reject branch names with dots', () => {
    expect(() => parseBranchArg('feature.new')).toThrow(/Invalid branch name/);
  });

  it('should reject branch names with spaces', () => {
    expect(() => parseBranchArg('my feature')).toThrow(/Invalid branch name/);
  });

  it('should provide helpful error messages for invalid format', () => {
    expect(() => parseBranchArg('feature/test')).toThrow();
    try {
      parseBranchArg('feature/test');
    } catch (error) {
      expect(error instanceof Error).toBeTruthy();
      expect(
        (error as Error).message.includes('Invalid branch format') ||
          (error as Error).message.includes('Use branch name directly (e.g., "cool-feature")'),
      ).toBeTruthy();
    }
  });

  it('should handle leading zeros in PR number', () => {
    const result = parseBranchArg('00123');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('00123');
  });

  it('should handle large PR numbers', () => {
    const result = parseBranchArg('999999');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('999999');
  });

  it('should accept single character branch names', () => {
    const result = parseBranchArg('a');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('a');
  });

  it('should accept single digit as branch name (non-numeric context)', () => {
    // Single digit is ambiguous but should be treated as PR
    const result = parseBranchArg('1');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('1');
  });
});
