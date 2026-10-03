export async function createDownloadablePdfBlob(pdf: import("jspdf").jsPDF): Promise<Blob> {
  const jsPdfBytes = pdf.output("arraybuffer");
  try {
    const { PDFDocument, PDFName, PDFNumber, PDFNull, PDFArray } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(jsPdfBytes);
    const pages = pdfDoc.getPages();
    if (pages.length > 0) {
      const xyzArray = PDFArray.withContext(pdfDoc.context);
      xyzArray.push(pages[0].ref);
      xyzArray.push(PDFName.of("XYZ"));
      xyzArray.push(PDFNull);
      xyzArray.push(PDFNull);
      xyzArray.push(PDFNumber.of(1.0));
      pdfDoc.catalog.set(PDFName.of("OpenAction"), xyzArray);
    }
    const modifiedBytes = await pdfDoc.save();
    const modifiedArrayBuffer = new ArrayBuffer(modifiedBytes.byteLength);
    new Uint8Array(modifiedArrayBuffer).set(modifiedBytes);
    return new Blob([modifiedArrayBuffer], { type: "application/pdf" });
  } catch (error) {
    console.warn("PDF post-processing failed; downloading the base PDF instead", error);
    return new Blob([jsPdfBytes], { type: "application/pdf" });
  }
}

