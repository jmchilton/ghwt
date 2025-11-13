import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseBranchArg } from './branch-parser.js';

describe('parseBranchArg', () => {
  it('should detect PR from numeric string', () => {
    const result = parseBranchArg('1234');
    assert.strictEqual(result.type, 'pr');
    assert.strictEqual(result.name, '1234');
  });

  it('should detect branch from alphanumeric name', () => {
    const result = parseBranchArg('cool-feature');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'cool-feature');
  });

  it('should accept branch names with slashes', () => {
    const result = parseBranchArg('fix/bug-123');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'fix/bug-123');
  });

  it('should reject old feature/ prefix', () => {
    assert.throws(() => parseBranchArg('feature/cool'));
  });

  it('should reject old bug/ prefix', () => {
    assert.throws(() => parseBranchArg('bug/fix'));
  });

  it('should reject old pr/ prefix', () => {
    assert.throws(() => parseBranchArg('pr/1234'));
  });

  it('should reject invalid characters', () => {
    assert.throws(() => parseBranchArg('invalid branch!'));
  });
});
