// Read a GameSheet PDF on this computer (never uploaded). The app supplies pdf.js (window.pdfjsLib), as Bulldogs
// Watch Party already does from its vendor/ folder.

/** The first page's text items, y measured down from the top, in the shape parseGameSheet() reads. */
export async function pdfItems(file, pdfjsLib) {
  if (!pdfjsLib) throw new Error('The PDF reader isn’t loaded');
  if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') throw new Error('That isn’t a PDF. Download the game sheet from GameSheet as a PDF.');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  doc.destroy();
  return tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width }));
}
