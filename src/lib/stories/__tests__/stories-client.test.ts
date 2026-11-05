import { describe, expect, it } from 'vitest';
import { currentPrompt, storyStatusLabel, type TurnDoc } from '../types';

function turn(index: number, role: TurnDoc['role'], kind: TurnDoc['kind']): TurnDoc {
  return { id: String(index), ownerUid: 'p1', index, role, kind, promptDisplay: null, options: null, expects: null, progress: null, inputDisplay: null };
}

describe('current prompt', () => {
  it('is the newest AI prompt, and none while the newest turn is the child’s or the story is done', () => {
    expect(currentPrompt([])).toBeNull();
    expect(currentPrompt([turn(0, 'ai', 'prompt')])?.index).toBe(0);
    expect(currentPrompt([turn(2, 'ai', 'prompt'), turn(0, 'ai', 'prompt'), turn(1, 'child', 'input')])?.index).toBe(2);
    expect(currentPrompt([turn(0, 'ai', 'prompt'), turn(1, 'child', 'input')])).toBeNull();
    expect(currentPrompt([turn(0, 'ai', 'prompt'), turn(1, 'child', 'input'), turn(2, 'ai', 'done')])).toBeNull();
  });

  it('labels every status for children', () => {
    expect(storyStatusLabel('complete')).toBe('Story ready');
    expect(storyStatusLabel('creating')).toBe('Still being made');
  });
});
