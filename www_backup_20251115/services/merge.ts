import { PDFDocument, rgb, StandardFonts, PageSizes, grayscale } from 'pdf-lib';
import QRCode from 'qrcode';
import type { Evidence, Report } from '../types';
import { generateCaseSummary } from './geminiService';
import { getAllReportsIndexed, calculateSHA512 } from './forensicService';

const addWatermark = (page: any, font: any) => {
    page.drawText('✔ Patent Pending Verum Omnis', {
        x: 30,
        y: 30,
        font,
        size: 8,
        color: grayscale(0.7),
        opacity: 0.8,
    });
};

export const mergeCaseFilePdf = async (updateStatus: (status: string) => void): Promise<Blob> => {
    const { reports, evidence } = await getAllReportsIndexed();
    if (reports.length === 0) throw new Error("No reports available to merge.");

    const evidenceMap = new Map(evidence.map(e => [e.id, e]));
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
    const pageMargin = 70;
    
    // 1. Front Narrative
    updateStatus("Generating case summary...");
    const summary = await generateCaseSummary(reports, evidence);
    let currentPage = pdfDoc.addPage(PageSizes.A4);
    let { width, height } = currentPage.getSize();
    let y = height - pageMargin;
    currentPage.drawText("Case Narrative Summary", { x: pageMargin, y, font: fontBold, size: 24 });
    y -= 50;
    
    const summaryLines = summary.split('\n');
    for (const line of summaryLines) {
        if (y < pageMargin + 20) { 
            addWatermark(currentPage, font);
            currentPage = pdfDoc.addPage(PageSizes.A4);
            y = currentPage.getHeight() - pageMargin; 
        }
        currentPage.drawText(line, { x: pageMargin, y, font, size: 11, lineHeight: 15, maxWidth: width - (pageMargin * 2) });
        y -= 15 * (Math.ceil(line.length / 80) || 1); // Approximate line wrapping
    }
    addWatermark(currentPage, font);

    // 2. Table of Contents
    updateStatus("Building table of contents...");
    currentPage = pdfDoc.addPage(PageSizes.A4);
    y = currentPage.getHeight() - pageMargin;
    currentPage.drawText("Table of Contents", { x: pageMargin, y, font: fontBold, size: 24 });
    y -= 50;
    reports.forEach((report) => {
        if (y < pageMargin) { 
            addWatermark(currentPage, font);
            currentPage = pdfDoc.addPage(PageSizes.A4);
            y = currentPage.getHeight() - pageMargin;
        }
        currentPage.drawText(`Chapter ${report.chapterIndex}: ${report.title}`, { x: pageMargin, y, font, size: 12, maxWidth: width - (pageMargin * 2) });
        y -= 20;
    });
    addWatermark(currentPage, font);

    // 3. Each Report as Chapter
    for (const report of reports) {
        updateStatus(`Adding Chapter ${report.chapterIndex}: ${report.title}`);
        currentPage = pdfDoc.addPage(PageSizes.A4);
        y = currentPage.getHeight() - pageMargin;
        currentPage.drawText(`Chapter ${report.chapterIndex}: ${report.title}`, { x: pageMargin, y, font: fontBold, size: 18 });
        y -= 30;

        if (report.findings.length > 0) {
             if (y < pageMargin) { addWatermark(currentPage, font); currentPage = pdfDoc.addPage(PageSizes.A4); y = currentPage.getHeight() - pageMargin; }
             currentPage.drawText("Key Findings", { x: pageMargin, y, font: fontBold, size: 14 });
             y -= 25;
             for(const finding of report.findings) {
                 if (y < pageMargin + 60) { addWatermark(currentPage, font); currentPage = pdfDoc.addPage(PageSizes.A4); y = currentPage.getHeight() - pageMargin; }
                 currentPage.drawText(`${finding.title} (${finding.verification})`, { x: pageMargin, y, font: fontBold, size: 11, maxWidth: width - (pageMargin * 2) });
                 y -= 15;
                 currentPage.drawText(finding.rationale, { x: pageMargin + 10, y, font, size: 10, lineHeight: 14, maxWidth: width - (pageMargin * 2) - 10 });
                 y -= 40;
             }
        }

        if (report.contradictions.length > 0) {
            if (y < pageMargin) { addWatermark(currentPage, font); currentPage = pdfDoc.addPage(PageSizes.A4); y = currentPage.getHeight() - pageMargin; }
            currentPage.drawText("Contradictions", { x: pageMargin, y, font: fontBold, size: 14 });
            y -= 25;
            for (const contradiction of report.contradictions) {
                if (y < pageMargin + 60) { addWatermark(currentPage, font); currentPage = pdfDoc.addPage(PageSizes.A4); y = currentPage.getHeight() - pageMargin; }
                currentPage.drawText(`${contradiction.type} (${contradiction.verification})`, { x: pageMargin, y, font: fontBold, size: 11 });
                y-= 15;
                currentPage.drawText(contradiction.explanation, { x: pageMargin + 10, y, font, size: 10, lineHeight: 14, maxWidth: width - (pageMargin * 2) - 10 });
                y -= 40;
            }
        }
        addWatermark(currentPage, font);
    }
    
    // 4. Appendices
    const evidenceIndexPage = pdfDoc.addPage(PageSizes.A4);
    y = evidenceIndexPage.getHeight() - pageMargin;
    evidenceIndexPage.drawText("Appendix A: Evidence Index", { x: pageMargin, y, font: fontBold, size: 24 });
    y -= 30;
    evidence.forEach(e => {
        if (y < pageMargin) { y = evidenceIndexPage.getHeight() - pageMargin; evidenceIndexPage.addPage(); }
        evidenceIndexPage.drawText(`${e.name} (SHA-512: ${e.sha512.substring(0,16)}...)`, { x: pageMargin, y, font: fontMono, size: 9});
        y -= 15;
    })
    addWatermark(evidenceIndexPage, font);
    
    const timelinePage = pdfDoc.addPage(PageSizes.A4);
    y = timelinePage.getHeight() - pageMargin;
    timelinePage.drawText("Appendix B: Timeline Index", { x: pageMargin, y, font: fontBold, size: 24 });
    y -= 50;
    const allTimelineEvents = reports.flatMap(r => r.timeline);
    if (allTimelineEvents.length === 0) {
        timelinePage.drawText("No timeline events recorded in this case file.", { x: pageMargin, y, font, size: 12});
    } else {
        allTimelineEvents.forEach(event => {
            if (y < pageMargin) { y = timelinePage.getHeight() - pageMargin; timelinePage.addPage(); }
            timelinePage.drawText(`${event.date}: ${event.event}`, { x: pageMargin, y, font, size: 10 });
            y -= 15;
        });
    }
    addWatermark(timelinePage, font);
    
    // 5. Final Certification Page
    updateStatus("Sealing final document...");
    const sealPage = pdfDoc.addPage(PageSizes.A4);
    const allHashes = evidence.map(e => e.sha512).sort().join('');
    const masterHash = await calculateSHA512(allHashes);
    const qrData = JSON.stringify({ masterHash, reportCount: reports.length, evidenceCount: evidence.length, timestamp: new Date().toISOString() });
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { errorCorrectionLevel: 'H' });
    const qrImage = await pdfDoc.embedPng(qrCodeDataUrl);
    sealPage.drawImage(qrImage, { x: sealPage.getWidth()/2 - 100, y: sealPage.getHeight()/2, width: 200, height: 200 });
    sealPage.drawText("Final Certification", { x: sealPage.getWidth()/2 - 70, y: sealPage.getHeight()/2 + 220, font: fontBold, size: 24});
    sealPage.drawText(`Master Case Hash (SHA-512): ${masterHash}`, { x: pageMargin, y: pageMargin + 50, font: fontMono, size: 8, maxWidth: width - (pageMargin * 2) });
    sealPage.drawText(`Generated: ${new Date().toUTCString()}`, { x: pageMargin, y: pageMargin + 20, font: font, size: 10 });
    addWatermark(sealPage, font);

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
};
