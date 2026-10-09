import { describe, expect, it } from 'vitest';
import { buildPdfBytes } from '../../src/core/export/pdf.js';
import { timestampedFilename } from '../../src/core/export/filename.js';

/** A minimal but structurally valid JPEG header, enough to stand in as the
 *  embedded image payload. */
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);

async function pdfText(blob: Blob): Promise<string> {
  // latin1 keeps byte offsets and character indices aligned, which matters
  // for checking the cross-reference table.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

describe('buildPdfBytes', () => {
  it('produces a PDF blob', async () => {
    const blob = buildPdfBytes(FAKE_JPEG, 800, 600);

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(FAKE_JPEG.length);
  });

  it('starts with a PDF header and ends with the EOF marker', async () => {
    const text = await pdfText(buildPdfBytes(FAKE_JPEG, 800, 600));

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.endsWith('%%EOF')).toBe(true);
  });

  it('declares all five objects plus the free entry in the xref table', async () => {
    const text = await pdfText(buildPdfBytes(FAKE_JPEG, 800, 600));

    expect(text).toContain('xref\n0 6\n');
    expect(text).toContain('/Size 6 /Root 1 0 R');
  });

  it('records byte offsets that actually point at their objects', async () => {
    const text = await pdfText(buildPdfBytes(FAKE_JPEG, 800, 600));

    const xrefStart = Number(/startxref\n(\d+)\n%%EOF$/.exec(text)![1]);
    expect(text.slice(xrefStart, xrefStart + 4)).toBe('xref');

    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(5);

    entries.forEach((offset, index) => {
      expect(text.slice(offset, offset + 7)).toBe(`${index + 1} 0 obj`);
    });
  });

  it('sizes the page to the image dimensions', async () => {
    const text = await pdfText(buildPdfBytes(FAKE_JPEG, 1234, 567));

    expect(text).toContain('/MediaBox [0 0 1234 567]');
    expect(text).toContain('/Width 1234 /Height 567');
  });

  it('embeds the JPEG with a DCTDecode filter and the correct length', async () => {
    const text = await pdfText(buildPdfBytes(FAKE_JPEG, 800, 600));

    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain(`/Length ${FAKE_JPEG.length}`);
  });

  it('embeds the JPEG bytes verbatim', async () => {
    const blob = buildPdfBytes(FAKE_JPEG, 800, 600);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const needle = Array.from(FAKE_JPEG, (b) => String.fromCharCode(b)).join('');
    const haystack = Array.from(bytes, (b) => String.fromCharCode(b)).join('');

    expect(haystack).toContain(needle);
  });

  it('draws the image full-bleed across the page', async () => {
    const text = await pdfText(buildPdfBytes(FAKE_JPEG, 800, 600));

    expect(text).toContain('q 800 0 0 600 0 0 cm /Im0 Do Q');
  });

  it.each([
    [0, 600],
    [800, 0],
    [-1, 600],
    [800.5, 600],
  ])('rejects invalid page dimensions %s x %s', (width, height) => {
    expect(() => buildPdfBytes(FAKE_JPEG, width, height)).toThrow(RangeError);
  });

  it('handles a tall full-page capture without corrupting offsets', async () => {
    const text = await pdfText(buildPdfBytes(FAKE_JPEG, 1440, 32_000));

    expect(text).toContain('/MediaBox [0 0 1440 32000]');
    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)];
    expect(entries).toHaveLength(5);
  });
});

describe('timestampedFilename', () => {
  it('formats a sortable, zero-padded stamp', () => {
    const date = new Date(2026, 0, 5, 9, 7, 3);
    expect(timestampedFilename('png', date)).toBe('snapcapture-20260105-090703.png');
  });

  it('uses the supplied extension', () => {
    const date = new Date(2026, 11, 31, 23, 59, 59);
    expect(timestampedFilename('webm', date)).toBe('snapcapture-20261231-235959.webm');
  });

  it('produces a name with no path separators or characters Windows rejects', () => {
    const name = timestampedFilename('pdf', new Date(2026, 5, 15, 12, 0, 0));
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
