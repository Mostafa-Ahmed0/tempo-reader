import { describe, expect, it } from 'vitest';
import { FORMAT_CAVEAT, FORMAT_FAMILIES, EXT_KIND, familyName, supportedFormatsText } from './formats';
import { ACCEPT_ATTR, SUPPORTED_EXTENSIONS, UnsupportedFormatError, parseFile } from './index';

describe('supported formats: one source of truth', () => {
  it('the parser extension list and the picker accept list are derived from FORMAT_FAMILIES', () => {
    const fromFamilies = FORMAT_FAMILIES.flatMap((f) => Object.keys(f.extensions));
    expect(SUPPORTED_EXTENSIONS).toEqual(fromFamilies);
    expect(Object.keys(EXT_KIND)).toEqual(fromFamilies);
    const accept = ACCEPT_ATTR.split(',');
    for (const e of fromFamilies) expect(accept).toContain(`.${e}`);
  });

  it('has human names for the display', () => {
    expect(FORMAT_FAMILIES.map(familyName)).toEqual([
      'PDF',
      'EPUB',
      'MOBI/AZW3',
      'Word (DOCX, DOC)',
      'ODT',
      'RTF',
      'FB2',
      'HTML',
      'Markdown',
      'plain text',
    ]);
    expect(supportedFormatsText()).toBe('PDF, EPUB, MOBI/AZW3, Word (DOCX, DOC), ODT, RTF, FB2, HTML, Markdown and plain text');
    expect(FORMAT_CAVEAT).toMatch(/scanned pdf.*drm/i);
  });

  it('the "unsupported file" error lists the same formats', async () => {
    const err = await parseFile(new File([new Uint8Array([0, 1, 2, 0, 255])], 'a.xyz')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedFormatError);
    expect((err as Error).message).toContain(`Supported: ${supportedFormatsText()}.`);
  });
});
