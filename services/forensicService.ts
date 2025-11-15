import { getDocument } from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts, PageSizes, grayscale } from 'pdf-lib';
import QRCode from 'qrcode';
import type { Evidence, Report, ReportsIndexMeta, Jurisdiction } from '../types';

// =================================================================
// Hashing Service (Original)
// =================================================================

export const calculateSHA512 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-512', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

// =================================================================
// IndexedDB Service (New)
// =================================================================

const DB_NAME = 'verum_db';
const DB_VERSION = 1;
const EVIDENCE_STORE = 'evidence';
const REPORTS_STORE = 'reports';
const META_STORE = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {  
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB error:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(EVIDENCE_STORE)) {
                db.createObjectStore(EVIDENCE_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(REPORTS_STORE)) {
                const reportStore = db.createObjectStore(REPORTS_STORE, { keyPath: 'id' });
                reportStore.createIndex('chapterIndex', 'chapterIndex', { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'key' });
            }
        };
    });
    return dbPromise;
};


export const saveEvidence = async (file: File, jurisdiction: Jurisdiction, timezone: string): Promise<Evidence> => {
    const db = await openDB();
    const sha512 = await calculateSHA512(file);
    const evidence: Evidence = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        blob: file,
        sha512,
        createdAt: new Date(),
        jurisdiction,
        timezone,
        meta: {}
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(EVIDENCE_STORE, 'readwrite');
        const store = transaction.objectStore(EVIDENCE_STORE);
        const request = store.put(evidence);
        transaction.oncomplete = () => resolve(evidence);
        transaction.onerror = () => reject(transaction.error);
    });
};

export const saveReport = async (report: Omit<Report, 'id' | 'createdAt' | 'updatedAt' | 'chapterIndex'>): Promise<Report> => {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
        const metaTransaction = db.transaction(META_STORE, 'readwrite');
        const metaStore = metaTransaction.objectStore(META_STORE);
        const getMetaRequest = metaStore.get('reports_index');

        getMetaRequest.onsuccess = () => {
            let meta: ReportsIndexMeta = getMetaRequest.result || { key: 'reports_index', order: [], lastChapterIndex: 0 };
            const nextChapterIndex = meta.lastChapterIndex + 1;

            const fullReport: Report = {
                ...report,
                id: crypto.randomUUID(),
                createdAt: new Date(),
                updatedAt: new Date(),
                chapterIndex: nextChapterIndex
            };

            meta.order.push(fullReport.id);
            meta.lastChapterIndex = nextChapterIndex;
            metaStore.put(meta);

            metaTransaction.oncomplete = () => {
                 const reportTransaction = db.transaction(REPORTS_STORE, 'readwrite');
                 const reportStore = reportTransaction.objectStore(REPORTS_STORE);
                 const reportRequest = reportStore.put(fullReport);
                 reportTransaction.oncomplete = () => resolve(fullReport);
                 reportTransaction.onerror = () => reject(reportTransaction.error);
            };
            metaTransaction.onerror = () => reject(metaTransaction.error);
        }
        getMetaRequest.onerror = () => reject(getMetaRequest.error);
    });
};


export const getAllReportsIndexed = async (): Promise<{ reports: Report[]; evidence: Evidence[] }> => {
    const db = await openDB();
    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction([REPORTS_STORE, EVIDENCE_STORE, META_STORE], 'readonly');
        const reportStore = transaction.objectStore(REPORTS_STORE);
        const evidenceStore = transaction.objectStore(EVIDENCE_STORE);
        const metaStore = transaction.objectStore(META_STORE);
        
        const metaReq = metaStore.get('reports_index');
        metaReq.onsuccess = () => {
            const order = metaReq.result?.order ?? [];
            const reportsReq = reportStore.getAll();
            reportsReq.onsuccess = () => {
                const reportsUnordered = reportsReq.result as Report[];
                const reportsMap = new Map(reportsUnordered.map(r => [r.id, r]));
                const reports = order.map(id => reportsMap.get(id)).filter(Boolean) as Report[];

                const evidenceIds = new Set(reports.flatMap(r => r.evidenceRefs.map(ref => ref.id)));
                
                const evidenceReq = evidenceStore.getAll();
                evidenceReq.onsuccess = () => {
                    const allEvidence = evidenceReq.result as Evidence[];
                    const relatedEvidence = allEvidence.filter(e => evidenceIds.has(e.id));
                    resolve({ reports, evidence: relatedEvidence });
                };
                evidenceReq.onerror = () => reject(evidenceReq.error);
            };
            reportsReq.onerror = () => reject(reportsReq.error);
        };
        metaReq.onerror = () => reject(metaReq.error);
    });
};

export const getEvidenceById = async (id: string): Promise<Evidence | undefined> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(EVIDENCE_STORE, 'readonly');
        const store = transaction.objectStore(EVIDENCE_STORE);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export const clearEvidenceAndReports = async ({ alsoDeleteMerged = false } = {}): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([EVIDENCE_STORE, REPORTS_STORE, META_STORE], 'readwrite');
        const evidenceStore = transaction.objectStore(EVIDENCE_STORE);
        const reportsStore = transaction.objectStore(REPORTS_STORE);
        const metaStore = transaction.objectStore(META_STORE);

        evidenceStore.clear();
        reportsStore.clear();
        metaStore.delete('reports_index');
        
        transaction.oncomplete = () => {
            // Placeholder for deleting merged files if they were stored locally
            if (alsoDeleteMerged) {
                console.log("Also deleting merged case files (placeholder).");
            }
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
    });
};


// =================================================================
// PDF Processing Service (New)
// =================================================================

let logoBytes: ArrayBuffer | null = null;
const getLogoBytes = async (): Promise<ArrayBuffer> => {
    if (logoBytes) return logoBytes;
    const logoSvgBase64 = "PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0OCIgZmlsbD0iIzFmMjkzNyIgc3Ryb2tlPSIjNGI1NTYzIiBzdHJva2Utd2lkdGg9IjIiLz48cGF0aCBkPSJNIDUwLDE1IEEgMzUsMzUgMCAxIDEgNTAsODUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2U1ZTdlYiIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtZGFzaGFycmF5PSI1IDUiIHRyYW5zZm9ybT0icm90YXRlKDQ1IDUwIDUwKSIvPjxwYXRoIGQ9Ik0gNTAsMjUgQSAyNSwyNSAwIDEgMCA1MCw3NSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNmI3MjgwIiBzdHJva2Utd2lkdGg9IjMiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSIxMCIgZmlsbD0iIzNiODJmNiIvPjwvc3ZnPg==";
    logoBytes = Uint8Array.from(atob(logoSvgBase64), c => c.charCodeAt(0)).buffer;
    return logoBytes;
};

export const generateSealedPdf = async (report: Report, evidence: Evidence): Promise<Blob> => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setProducer('Verum Omnis v5.2.7');
    pdfDoc.setAuthor('Verum Omnis AI System');
    pdfDoc.setCreator('Verum Omnis v5.2.6');
    pdfDoc.setTitle(`Verum Omnis Forensic Report: ${report.title}`);
    pdfDoc.setSubject('Behavioral Forensic Analysis');
    pdfDoc.setKeywords(['Forensic', 'Legal', 'Evidence', 'Blockchain', `SHA-512:${evidence.sha512}`]);
    
    // Custom Metadata (simulating Android implementation)
    pdfDoc.setCustomMetadata('EvidenceHash', evidence.sha512);
    pdfDoc.setCustomMetadata('Jurisdiction', report.jurisdiction);
    pdfDoc.setCustomMetadata('ReportID', report.id);


    const page = pdfDoc.addPage(PageSizes.A4);
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
    const margin = 50;
    let y = height - margin - 20;

    // Header
    const logoImage = await pdfDoc.embedPng(await getLogoBytes());
    page.drawImage(logoImage, { x: margin, y: y - 40, width: 40, height: 40 });
    page.drawText('VERUM OMNIS', { x: margin + 50, y: y - 15, font: fontBold, size: 24, color: rgb(0.12, 0.16, 0.22) });
    page.drawText('Gold Standard for Forensic Chat-Log & Evidence Analysis', { x: margin + 50, y: y - 30, font: font, size: 10, color: rgb(0.3, 0.34, 0.4) });
    y -= 70;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: grayscale(0.8) });
    y -= 30;

    // Report Title
    page.drawText(`Forensic Report: ${report.title}`, { x: margin, y, font: fontBold, size: 18 });
    y -= 25;
    page.drawText(`Generated: ${report.updatedAt.toUTCString()}`, {x: margin, y, font: font, size: 10, color: grayscale(0.4)});
    y -= 40;

    // Key Findings
    page.drawText('Key Findings', { x: margin, y, font: fontBold, size: 16, color: rgb(0.1, 0.1, 0.4) });
    y -= 25;
    for (const finding of report.findings) {
        page.drawText(`Finding: ${finding.title}`, { x: margin, y, font: fontBold, size: 12 });
        y -= 18;
        page.drawText(`Rationale: ${finding.rationale}`, { x: margin + 10, y, font: font, size: 10, maxWidth: width - margin * 2 - 10, lineHeight: 14 });
        y -= 40; // Add space
    }
    
    // Contradictions
    if (report.contradictions.length > 0) {
        page.drawText('Contradictions Detected', { x: margin, y, font: fontBold, size: 16, color: rgb(0.5, 0.1, 0.1) });
        y -= 25;
        for (const contradiction of report.contradictions) {
            page.drawText(`Type: ${contradiction.type}`, { x: margin, y, font: fontBold, size: 12 });
            y-=18;
            page.drawText(`Explanation: ${contradiction.explanation}`, { x: margin + 10, y, font: font, size: 10, maxWidth: width - margin * 2 - 10, lineHeight: 14 });
            y -= 40;
        }
    }


    // Final Seal Page
    const sealPage = pdfDoc.addPage(PageSizes.A4);
    const sealFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const sealFontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

    sealPage.drawText('Ceremonial Statement of Gift and Independence', { x: width/2 - 200, y: height - 100, font: sealFontBold, size: 22});
    sealPage.drawText('(To accompany the Verum Omnis Constitutional Charter)', { x: width/2 - 140, y: height - 120, font: sealFont, size: 12});

    sealPage.drawText('Bound by SHA-512 forensic hashing, QR verification, and immutable blockchain\nanchoring, this constitution is beyond alteration. Its Stateless Clause guarantees that no\ngovernment, state, or corporation may override or control its rules.', {
        x: margin, y: height - 200, font: sealFont, size: 11, lineHeight: 15
    })

    sealPage.drawText('This is not a proposal awaiting permission. It is a final, immutable gift.', {
        x: margin, y: height - 260, font: sealFontBold, size: 11, lineHeight: 15
    })

    const qrData = JSON.stringify({ 
        reportId: report.id, 
        evidenceSha512: evidence.sha512, 
        timestamp: report.updatedAt.toISOString(), 
        jurisdiction: report.jurisdiction 
    });
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { errorCorrectionLevel: 'H' });
    const qrImage = await pdfDoc.embedPng(qrCodeDataUrl);
    
    sealPage.drawImage(qrImage, { x: width / 2 - 75, y: height / 2 - 75, width: 150, height: 150 });
    
    sealPage.drawText('Sealed with SHA-512 Hash:', { x: margin, y: margin + 80, font: sealFont, size: 10});
    sealPage.drawText(evidence.sha512, { x: margin, y: margin + 65, font: fontMono, size: 8});
    sealPage.drawText('Immutable • Forensic • Final', { x: margin, y: margin + 45, font: sealFontBold, size: 10});


    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    
    const header = new TextDecoder().decode(pdfBytes.slice(0, 8));
    if (!header.startsWith('%PDF-1.7')) {
        console.warn("PDF header is not 1.7! It is:", header);
    }
    
    return new Blob([pdfBytes], { type: 'application/pdf' });
};

// Placeholder for merge case file functionality
export const mergeCaseFilePdf = async (): Promise<Blob> => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    page.drawText('Merged Case File - Functionality Pending', { x: 50, y: page.getHeight() / 2 });
    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
};

// =================================================================
// PDF Text Extraction (New)
// =================================================================

let pdfjsWorkerSrc = '';
export const setPdfJsWorkerSrc = (src: string) => {
    pdfjsWorkerSrc = src;
};

export const extractPdfText = async (file: File): Promise<string> => {
    const { GlobalWorkerOptions } = await import('pdfjs-dist');
    GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

    const buffer = await file.arrayBuffer();
    const pdf = await getDocument(buffer).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
    }
    return fullText;
};