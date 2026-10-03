import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface ReceiptPdfInput {
  hospitalName: string;
  hospitalContact: string;
  patientName: string;
  patientNumber: string;
  invoiceNumber: string;
  issuedAt: string;
  paidAt: string | null;
  currency: string;
  items: Array<{ description: string; quantity: string; unitPrice: string; amount: string }>;
  subtotal: string;
  tax: string;
  total: string;
  paidTotal: string;
  payments: Array<{ method: string; reference: string; amount: string; at: string }>;
}

export async function renderReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const { height } = page.getSize();
  const titleFont = await document.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  let y = height - 60;
  const draw = (text: string, size: number, bold = false, gap = 16) => {
    page.drawText(text.slice(0, 105), { x: 50, y, size, font: bold ? titleFont : bodyFont, color: rgb(0.1, 0.2, 0.25) });
    y -= gap;
  };
  draw(input.hospitalName, 20, true, 24);
  draw(input.hospitalContact, 10, false, 20);
  draw(`Receipt for invoice ${input.invoiceNumber}`, 13, true, 18);
  draw(`Patient: ${input.patientName} · ${input.patientNumber}`, 10, false, 15);
  draw(`Issued: ${input.issuedAt} · Paid: ${input.paidAt ?? 'pending'}`, 10, false, 20);
  draw('Line items', 12, true, 17);
  for (const item of input.items) {
    draw(`${item.description} — ${item.quantity} x ${item.unitPrice} = ${item.amount} ${input.currency}`, 9, false, 14);
    if (y < 160) break;
  }
  draw(`Subtotal ${input.subtotal} · Tax ${input.tax} · Total ${input.total} ${input.currency}`, 10, true, 16);
  draw(`Paid ${input.paidTotal} ${input.currency}`, 10, true, 18);
  draw('Payments', 12, true, 17);
  for (const payment of input.payments) {
    draw(`${payment.method} · ${payment.reference} · ${payment.amount} · ${payment.at}`, 9, false, 14);
    if (y < 80) break;
  }
  const bytes = await document.save();
  return Buffer.from(bytes);
}
