import { describe, it, expect } from 'vitest';
import { GhwtConfigSchema } from '../../lib/schemas.js';

const MINIMAL_CONFIG = {
  projectsRoot: '~/projects',
  vaultPath: '~/vault',
};

describe('GhwtConfigSchema: editor', () => {
  it('defaults to none so create does not launch an editor', () => {
    const parsed = GhwtConfigSchema.parse(MINIMAL_CONFIG);
    expect(parsed.editor).toBe('none');
  });

  it('accepts code', () => {
    const parsed = GhwtConfigSchema.parse({ ...MINIMAL_CONFIG, editor: 'code' });
    expect(parsed.editor).toBe('code');
  });

  it('accepts cursor', () => {
    const parsed = GhwtConfigSchema.parse({ ...MINIMAL_CONFIG, editor: 'cursor' });
    expect(parsed.editor).toBe('cursor');
  });

  it('rejects an unknown editor', () => {
    expect(() => GhwtConfigSchema.parse({ ...MINIMAL_CONFIG, editor: 'vim' })).toThrow();
  });

  it('leaves the other launch defaults alone', () => {
    const parsed = GhwtConfigSchema.parse(MINIMAL_CONFIG);
    expect(parsed.terminalUI).toBe('wezterm');
    expect(parsed.terminalMultiplexer).toBe('tmux');
  });
});
