/**
 * Minimal single-page PDF writer: one JPEG XObject drawn full-bleed onto a
 * page sized to the image's pixel dimensions.
 *
 * Hand-rolled on purpose. A PDF library would be the largest dependency in an
 * otherwise dependency-free extension, and every byte shipped to the Chrome
 * Web Store is reviewed surface area. The format needed here is a fixed
 * five-object document, so the cost of writing it directly is small and the
 * output is auditable.
 *
 * Structure (object numbers are fixed):
 *   1 Catalog -> 2 Pages -> 3 Page -> 4 Image XObject, 5 Content stream
 */

const PDF_HEADER = '%PDF-1.4\n';
const OBJECT_COUNT = 5;

export function buildPdfBytes(jpegBytes: Uint8Array, width: number, height: number): Blob {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('PDF page dimensions must be positive integers.');
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = new Map<number, number>();
  let offset = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushText = (text: string) => push(encoder.encode(text));
  const startObject = (n: number) => offsets.set(n, offset);

  pushText(PDF_HEADER);

  startObject(1);
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  pushText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObject(3);
  pushText(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  startObject(4);
  pushText(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${jpegBytes.length} >>\nstream\n`
  );
  push(jpegBytes);
  pushText('\nendstream\nendobj\n');

  // `cm` scales the unit square to the full page, so the image fills it.
  const content = encoder.encode(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`);
  startObject(5);
  pushText(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`);
  push(content);
  pushText('\nendstream\nendobj\n');

  const xrefStart = offset;
  let xref = `xref\n0 ${OBJECT_COUNT + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= OBJECT_COUNT; n++) {
    xref += `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n`;
  }
  pushText(xref);
  pushText(`trailer\n<< /Size ${OBJECT_COUNT + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
