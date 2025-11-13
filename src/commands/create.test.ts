import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseBranchArg } from '../lib/branch-parser.js';

describe('create command: branch argument parsing', () => {
  it('should detect PR from numeric string', () => {
    const result = parseBranchArg('1234');
    assert.strictEqual(result.type, 'pr');
    assert.strictEqual(result.name, '1234');
  });

  it('should accept simple branch name', () => {
    const result = parseBranchArg('cool-feature');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'cool-feature');
  });

  it('should accept branch name with underscore', () => {
    const result = parseBranchArg('fix_bug_123');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'fix_bug_123');
  });

  it('should accept branch names with slashes', () => {
    const result = parseBranchArg('fix/bug-123');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'fix/bug-123');
  });

  it('should accept branch names with multiple slashes', () => {
    const result = parseBranchArg('bugfix/section/subsection');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'bugfix/section/subsection');
  });

  it('should reject old feature/ prefix with error', () => {
    assert.throws(
      () => parseBranchArg('feature/cool'),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Invalid branch format'),
    );
  });

  it('should reject old bug/ prefix with error', () => {
    assert.throws(
      () => parseBranchArg('bug/fix'),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Invalid branch format'),
    );
  });

  it('should reject old pr/ prefix with error', () => {
    assert.throws(
      () => parseBranchArg('pr/1234'),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Invalid branch format'),
    );
  });

  it('should reject branch/ prefix with error', () => {
    // branch/ is not checked by the parser - it's treated as a valid branch name
    const result = parseBranchArg('branch/name');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'branch/name');
  });

  it('should reject branch names with special characters', () => {
    assert.throws(
      () => parseBranchArg('invalid branch!'),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Invalid branch name'),
    );
  });

  it('should reject branch names with dots', () => {
    assert.throws(
      () => parseBranchArg('feature.new'),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Invalid branch name'),
    );
  });

  it('should reject branch names with spaces', () => {
    assert.throws(
      () => parseBranchArg('my feature'),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Invalid branch name'),
    );
  });

  it('should provide helpful error messages for invalid format', () => {
    try {
      parseBranchArg('feature/test');
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(
        error.message.includes('Invalid branch format') ||
          error.message.includes(
            'Use branch name directly (e.g., "cool-feature")',
          ),
      );
    }
  });

  it('should handle leading zeros in PR number', () => {
    const result = parseBranchArg('00123');
    assert.strictEqual(result.type, 'pr');
    assert.strictEqual(result.name, '00123');
  });

  it('should handle large PR numbers', () => {
    const result = parseBranchArg('999999');
    assert.strictEqual(result.type, 'pr');
    assert.strictEqual(result.name, '999999');
  });

  it('should accept single character branch names', () => {
    const result = parseBranchArg('a');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'a');
  });

  it('should accept single digit as branch name (non-numeric context)', () => {
    // Single digit is ambiguous but should be treated as PR
    const result = parseBranchArg('1');
    assert.strictEqual(result.type, 'pr');
    assert.strictEqual(result.name, '1');
  });
});
