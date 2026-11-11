import { describe, expect, it } from 'vitest';
import { printLayoutFormSchema } from '../shared';

describe('printLayoutFormSchema', () => {
  it('accepts a stored template: null colours, three-decimal measurements, no legacy box arrays', () => {
    const result = printLayoutFormSchema.safeParse({
      id: 'a4-landscape',
      name: 'A4 Landscape',
      leafWidth: 11.69,
      leafHeight: 8.27,
      leavesPerSpread: '1',
      font: null,
      fontSize: 24,
      coverLayout: {
        textBoxEnabled: true,
        imageBoxEnabled: true,
        imageBox: { x: 0.827, y: 1.17, width: 6.616, height: 6.5 },
        textBox: { x: 1, y: 2, width: 6.27, height: 7.68999, backgroundColor: '#F5F5DC', textColor: null, borderRadius: null },
      },
      printProductId: 'hardcover-a4-landscape',
      pageConstraints: { minPages: '', maxPages: '', pageMultiple: undefined },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coverLayout?.textBox?.textColor).toBeUndefined();
      expect(result.data.textBoxes).toEqual([]);
      expect(result.data.imageBoxes).toEqual([]);
    }
  });

  it('still requires a name and a positive page size', () => {
    const result = printLayoutFormSchema.safeParse({ name: '', leafWidth: 0, leafHeight: 8, leavesPerSpread: '1' });
    expect(result.success).toBe(false);
  });
});
