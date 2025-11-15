import { getDocument } from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts, PageSizes, grayscale } from 'pdf-lib';
import QRCode from 'qrcode';
import type { Evidence, Report, ReportsIndexMeta, Jurisdiction, Contradiction } from '../types';

// Import from new service files
import { runOcr as ocrRunner } from './ocr';
import { mergeCaseFilePdf as merger } from './merge';

// Re-export for App.tsx to consume
export const runOcr = ocrRunner;
export const mergeCaseFilePdf = merger;

// =================================================================
// Hashing Service
// =================================================================

export const calculateSHA512 = async (fileOrBlob: File | Blob | string): Promise<string> => {
    let buffer: ArrayBuffer;
    if (typeof fileOrBlob === 'string') {
        buffer = new TextEncoder().encode(fileOrBlob).buffer;
    } else {
        buffer = await fileOrBlob.arrayBuffer();
    }
    const hashBuffer = await crypto.subtle.digest('SHA-512', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
};

// =================================================================
// IndexedDB Service
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

export const updateEvidence = async (evidence: Evidence): Promise<Evidence> => {
    const db = await openDB();
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

                const allEvidenceIds = new Set<string>();
                reports.forEach(r => r.evidenceRefs.forEach(ref => allEvidenceIds.add(ref.id)));

                const evidenceReq = evidenceStore.getAll();
                evidenceReq.onsuccess = () => {
                    const allEvidence = evidenceReq.result as Evidence[];
                    const relatedEvidence = allEvidence.filter(e => allEvidenceIds.has(e.id));
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
            if (alsoDeleteMerged) {
                console.log("Also deleting merged case files (placeholder).");
            }
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
    });
};


// =================================================================
// PDF Processing Service
// =================================================================

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

export const generateSealedPdf = async (report: Report, evidence: Evidence): Promise<Blob> => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setProducer('Verum Omnis v5.2.7');
    pdfDoc.setAuthor('Verum Omnis AI System');
    pdfDoc.setCreator('Verum Omnis v5.2.7');
    pdfDoc.setTitle(`Verum Omnis Forensic Report: ${report.title}`);
    
    pdfDoc.setCustomMetadata('EvidenceHash', evidence.sha512);
    pdfDoc.setCustomMetadata('Jurisdiction', report.jurisdiction);
    pdfDoc.setCustomMetadata('ReportID', report.id);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

    let currentPage = pdfDoc.addPage(PageSizes.A4);
    const { width, height } = currentPage.getSize();
    const margin = 50;
    let y = height - margin;

    // Report Title
    currentPage.drawText(`Forensic Report: ${report.title}`, { x: margin, y, font: fontBold, size: 18 });
    y -= 25;
    currentPage.drawText(`Generated: ${report.updatedAt.toUTCString()}`, {x: margin, y, font: font, size: 10, color: grayscale(0.4)});
    y -= 40;

    if (report.findings.length > 0) {
        currentPage.drawText('Key Findings', { x: margin, y, font: fontBold, size: 16, color: rgb(0.1, 0.1, 0.4) });
        y -= 25;
        for (const finding of report.findings) {
             if (y < margin + 60) {
                addWatermark(currentPage, font);
                currentPage = pdfDoc.addPage(PageSizes.A4);
                y = currentPage.getHeight() - margin;
            }
            currentPage.drawText(`${finding.title} (${finding.verification})`, { x: margin, y, font: fontBold, size: 12, maxWidth: width - margin * 2 });
            y -= 18;
            currentPage.drawText(`Rationale: ${finding.rationale}`, { x: margin + 10, y, font: font, size: 10, maxWidth: width - margin * 2 - 10, lineHeight: 14 });
            y -= 40; 
        }
    }
    
    if (report.contradictions.length > 0) {
        if (y < margin + 60) { addWatermark(currentPage, font); currentPage = pdfDoc.addPage(PageSizes.A4); y = currentPage.getHeight() - margin; }
        currentPage.drawText('Contradictions Detected', { x: margin, y, font: fontBold, size: 16, color: rgb(0.5, 0.1, 0.1) });
        y -= 25;
        for (const contradiction of report.contradictions) {
            if (y < margin + 60) { addWatermark(currentPage, font); currentPage = pdfDoc.addPage(PageSizes.A4); y = currentPage.getHeight() - margin; }
            currentPage.drawText(`Type: ${contradiction.type} (${contradiction.verification})`, { x: margin, y, font: fontBold, size: 12 });
            y-=18;
            currentPage.drawText(`Explanation: ${contradiction.explanation}`, { x: margin + 10, y, font: font, size: 10, maxWidth: width - margin * 2 - 10, lineHeight: 14 });
            y -= 40;
        }
    }
    addWatermark(currentPage, font);

    const sealPage = pdfDoc.addPage(PageSizes.A4);
    
    const qrData = JSON.stringify({ reportId: report.id, evidenceSha512: evidence.sha512, timestamp: report.updatedAt.toISOString(), jurisdiction: report.jurisdiction });
    const qrCodeDataUrl = await QRCode.toDataURL(qrData, { errorCorrectionLevel: 'H' });
    const qrImage = await pdfDoc.embedPng(qrCodeDataUrl);
    
    sealPage.drawImage(qrImage, { x: width / 2 - 75, y: height / 2, width: 150, height: 150 });
    
    sealPage.drawText('Sealed with SHA-512 Hash:', { x: margin, y: margin + 80, font: font, size: 10});
    sealPage.drawText(evidence.sha512, { x: margin, y: margin + 65, font: fontMono, size: 8});
    addWatermark(sealPage, font);

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
};

// =================================================================
// PDF Text Extraction
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

// =================================================================
// Contradiction Engine (Local, Deterministic)
// =================================================================

const shuffle = <T>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

const analyzeContradictionsOnce = (reports: Report[], evidenceList: Evidence[]): Omit<Contradiction, 'verification'>[] => {
    const contradictions: Omit<Contradiction, 'verification'>[] = [];
    const evidenceMap = new Map(evidenceList.map(e => [e.id, e]));

    // Get a unique list of all evidence being analyzed
    const allEvidenceInScope: Evidence[] = [];
    reports.forEach(r => {
        r.evidenceRefs.forEach(ref => {
            const ev = evidenceMap.get(ref.id);
            if (ev && !allEvidenceInScope.some(e => e.id === ev.id)) {
                allEvidenceInScope.push(ev);
            }
        })
    });
    
    const textEvidence = allEvidenceInScope.filter(e => e.ocrText && e.ocrText.trim().length > 0);

    for (let i = 0; i < allEvidenceInScope.length; i++) {
        for (let j = i + 1; j < allEvidenceInScope.length; j++) {
            const evA = allEvidenceInScope[i];
            const evB = allEvidenceInScope[j];

            // Rule: cross_doc_drift (Filename-based)
            const nameA = evA.name.toLowerCase().replace(/\.[^/.]+$/, ""); // remove extension
            const nameB = evB.name.toLowerCase().replace(/\.[^/.]+$/, "");
            if ((nameA.includes(nameB) || nameB.includes(nameA)) && nameA !== nameB && evA.sha512 !== evB.sha512) {
                 contradictions.push({
                    type: 'cross_doc_drift',
                    claimA: `Evidence named "${evA.name}"`,
                    claimB: `Evidence named "${evB.name}"`,
                    sources: [evA.id, evB.id],
                    explanation: `Two files with similar names ('${evA.name}', '${evB.name}') have different content hashes, indicating a possible version mismatch or alteration.`,
                });
            }
        }
    }
    
    for (const evidence of textEvidence) {
        // Rule: metadata_mismatch (Content date vs. File creation date)
        const dateRegex = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/\d{4}\b/g;
        const mentionedDates = evidence.ocrText?.match(dateRegex);
        if (mentionedDates) {
            for (const dateStr of mentionedDates) {
                const mentionedDate = new Date(dateStr);
                const fileCreationDate = evidence.createdAt;
                // If a date in the past is mentioned in a file created much later, it's fine.
                // But if a future date is mentioned, it's a potential contradiction.
                if (mentionedDate > fileCreationDate) {
                    contradictions.push({
                        type: 'metadata_mismatch',
                        sources: [evidence.id],
                        explanation: `The document content mentions a future date (${mentionedDate.toLocaleDateString()}) relative to its creation date (${fileCreationDate.toLocaleDateString()}).`,
                        claimA: `File created: ${fileCreationDate.toLocaleDateString()}`,
                        claimB: `Content mentions: ${mentionedDate.toLocaleDateString()}`,
                    });
                }
            }
        }

        // Rule: omission (Detects references to missing exhibits)
        const omissionRegex = /(see|ref|reference|attachment|exhibit)\s+([A-Z0-9-]{1,10})/gi;
        let match;
        while ((match = omissionRegex.exec(evidence.ocrText!)) !== null) {
            const referencedExhibit = match[2].toLowerCase();
            const found = allEvidenceInScope.some(e => 
                e.name.toLowerCase().includes(referencedExhibit)
            );
            if (!found) {
                 contradictions.push({
                    type: 'omission',
                    sources: [evidence.id],
                    explanation: `Document "${evidence.name}" references an exhibit or attachment "${match[2]}" which was not found in the provided evidence set.`,
                    claimA: `Reference to "${match[2]}"`,
                    claimB: 'Evidence not provided',
                });
            }
        }
    }

    return contradictions;
};

export const runContradictionAnalysis = async (reports: Report[], evidence: Evidence[]): Promise<Contradiction[]> => {
    const allFoundContradictions: (Omit<Contradiction, 'verification'> & { key: string })[] = [];

    // Run the analysis 3 times with shuffled inputs to simulate multiple passes
    for (let i = 0; i < 3; i++) {
        const shuffledReports = shuffle(reports);
        const shuffledEvidence = shuffle(evidence);
        const results = analyzeContradictionsOnce(shuffledReports, shuffledEvidence);
        
        results.forEach(c => {
            // Create a stable key to identify unique contradictions across runs
            const key = `${c.type}-${[...c.sources].sort().join('-')}-${c.explanation}`;
            allFoundContradictions.push({ ...c, key });
        });
    }

    const contradictionCounts = new Map<string, { contradiction: Omit<Contradiction, 'verification'>, count: number }>();
    allFoundContradictions.forEach(c => {
        const existing = contradictionCounts.get(c.key);
        if (existing) {
            existing.count++;
        } else {
            const { key, ...contradiction } = c; // remove temporary key
            contradictionCounts.set(key, { contradiction, count: 1 });
        }
    });
    
    const finalContradictions: Contradiction[] = [];
    contradictionCounts.forEach(({ contradiction, count }) => {
        let verification: Contradiction['verification'] = 'Inconclusive (≤1/3)';
        if (count >= 3) { // Use >=3 to be safe
            verification = 'Verified (3/3)';
        } else if (count === 2) {
            verification = 'Consensus (2/3)';
        }
        finalContradictions.push({ ...contradiction, verification });
    });

    return finalContradictions;
};
