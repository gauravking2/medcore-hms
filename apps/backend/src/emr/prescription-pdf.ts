import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface PrescriptionPdfInput {
  hospitalName: string;
  hospitalContact: string;
  doctorName: string;
  doctorSpecialization: string;
  doctorLicense: string;
  patientName: string;
  patientNumber: string;
  issuedAt: string;
  prescriptionId: string;
  notes?: string | null;
  items: Array<{ medicine: string; dosage: string; frequency: string; duration: string; quantity?: string | null; instructions?: string | null }>;
  signed: boolean;
}

export async function renderPrescriptionPdf(input: PrescriptionPdfInput): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const { height } = page.getSize();
  const titleFont = await document.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  let y = height - 60;
  const draw = (text: string, size: number, bold = false, gap = 16) => {
    page.drawText(text.slice(0, 110), { x: 50, y, size, font: bold ? titleFont : bodyFont, color: rgb(0.1, 0.2, 0.25) });
    y -= gap;
  };
  draw(input.hospitalName, 20, true, 24);
  draw(input.hospitalContact, 10, false, 20);
  draw(`Prescription ${input.prescriptionId} · ${input.issuedAt}`, 11, true, 18);
  draw(`Doctor: ${input.doctorName} (${input.doctorSpecialization}, ${input.doctorLicense})`, 10, false, 16);
  draw(`Patient: ${input.patientName} · ${input.patientNumber}`, 10, false, 22);
  draw('Medicines', 13, true, 18);
  for (const [index, item] of input.items.entries()) {
    draw(`${index + 1}. ${item.medicine} — ${item.dosage}, ${item.frequency}, ${item.duration}`, 10, false, 15);
    if (item.quantity) draw(`    Quantity: ${item.quantity}`, 9, false, 13);
    if (item.instructions) draw(`    ${item.instructions}`, 9, false, 15);
    if (y < 120) break;
  }
  if (input.notes) draw(`Notes: ${input.notes}`, 10, false, 18);
  draw(input.signed ? 'Digitally signed by the treating doctor.' : 'Unsigned draft.', 10, true, 16);
  const bytes = await document.save();
  return Buffer.from(bytes);
}
