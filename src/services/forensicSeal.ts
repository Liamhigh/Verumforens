import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import { loadAssetArrayBuffer } from './assets';

/**
 * generateSealedPdf
 * - VO logo at top-center (PNG at /vo-logo.png)
 * - bottom-left tick: "✔ Patent Pending Verum Omnis"
 * - bottom-right QR with JSON(meta + sha512 + ts) + truncated SHA-512 above
 */
export async function generateSealedPdf(report: {
  title: string;
  body: string;
  sha512: string;
  meta?: Record<string, unknown>;
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const { width, height } = page.getSize();

  // Fonts
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // 1) Top-center logo (optional; skip if missing)
  try {
    const logoBytes = await loadAssetArrayBuffer('/vo-logo.png');
    const logoImg = await pdf.embedPng(logoBytes);
    const logoW = 120;
    const logoH = (logoImg.height / logoImg.width) * logoW;
    page.drawImage(logoImg, {
      x: (width - logoW) / 2,
      y: height - 60 - logoH,
      width: logoW,
      height: logoH
    });
  } catch (e) {
    // draw fallback text if no image
    page.drawText('VERUM OMNIS', {
      x: (width - 120) / 2,
      y: height - 80,
      size: 16,
      font
    });
  }

  // 2) Content
  const topY = height - 140;
  page.drawText(report.title, { x: 40, y: topY, size: 16, font });
  page.drawText(report.body,  { x: 40, y: topY - 28, size: 11, font, lineHeight: 14 });

  // 3) Bottom-left tick (no background watermark)
  page.drawText('✔ Patent Pending Verum Omnis', {
    x: 24, y: 24, size: 9, font, opacity: 0.85, color: rgb(0.2, 0.2, 0.2)
  });

  // 4) Bottom-right QR + hash
  const meta = { ...(report.meta || {}), sha512: report.sha512, ts: new Date().toISOString() };
  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(meta), { margin: 0, scale: 4 });
  const b64 = qrDataUrl.split(',')[1];
  const qrBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const qrImg = await pdf.embedPng(qrBytes);
  const q = 96;
  page.drawImage(qrImg, { x: width - q - 24, y: 24, width: q, height: q });
  page.drawText(report.sha512.slice(0, 24) + '…', {
    x: width - q - 24, y: 24 + q + 6, size: 8, font
  });

  return await pdf.save();
}
