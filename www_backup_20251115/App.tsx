import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import type { ChatItem, MessageItem, ReportItem, ActionRequestItem, Jurisdiction, Evidence, Report, AiMode, FileInfo, AnalysisStep } from './types';
import { getGeminiResponse, generateSealedReportFromEvidence, getJurisdictionFromCoords } from './services/geminiService';
import { 
    calculateSHA512, saveEvidence, saveReport, getAllReportsIndexed, clearEvidenceAndReports, 
    getEvidenceById, setPdfJsWorkerSrc, extractPdfText, runOcr, updateEvidence,
    runContradictionAnalysis, mergeCaseFilePdf
} from './services/forensicService';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import Icon from './components/Icon';

// Configure PDF.js worker
setPdfJsWorkerSrc(`https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs`);

const ClearDataModal: React.FC<{ isOpen: boolean, onClose: () => void, onConfirm: (alsoDeleteMerged: boolean) => void }> = ({ isOpen, onClose, onConfirm }) => {
    const [confirmText, setConfirmText] = useState('');
    const [alsoDeleteMerged, setAlsoDeleteMerged] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setConfirmText('');
            setAlsoDeleteMerged(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (confirmText === 'CLEAR VERUM') {
            onConfirm(alsoDeleteMerged);
            onClose();
        }
    }

    return ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md border border-gray-700">
                <h2 className="text-xl font-bold text-red-400">Clear All Evidence & Reports</h2>
                <p className="text-gray-300 mt-4">This action is permanent and cannot be undone. All locally stored evidence files and analysis reports will be deleted from this device.</p>
                <div className="mt-4">
                    <label className="flex items-center text-gray-300">
                        <input type="checkbox" className="h-4 w-4 bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500" checked={alsoDeleteMerged} onChange={e => setAlsoDeleteMerged(e.target.checked)} />
                        <span className="ml-2 text-sm">Also delete merged case files (if any)</span>
                    </label>
                </div>
                <p className="text-gray-400 mt-6 font-semibold">To confirm, please type <code className="bg-gray-900 text-red-400 px-1 rounded">CLEAR VERUM</code> below:</p>
                <input
                    type="text"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-sm focus:ring-red-500 focus:border-red-500 mt-2"
                />
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-gray-200 bg-gray-600 hover:bg-gray-500 transition">Cancel</button>
                    <button onClick={handleConfirm} disabled={confirmText !== 'CLEAR VERUM'} className="px-4 py-2 rounded-md text-white bg-red-600 hover:bg-red-700 disabled:bg-red-900 disabled:cursor-not-allowed transition">Confirm & Clear</button>
                </div>
            </div>
        </div>,
        document.getElementById('modal-root')!
    );
};

const GeolocationPermissionModal: React.FC<{ onRequest: () => void }> = ({ onRequest }) => (
    <div className="fixed inset-0 bg-gray-950 flex items-center justify-center z-50">
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md border border-gray-700 text-center">
            <h2 className="text-xl font-bold text-yellow-400">Location Access Required</h2>
            <p className="text-gray-300 mt-4">Verum Omnis requires location access for accurate jurisdiction selection and legal timestamping.</p>
            <div className="mt-6">
                <button onClick={onRequest} className="px-6 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700 transition">
                    Allow Access
                </button>
            </div>
        </div>
    </div>
);


const App: React.FC = () => {
    const [chatItems, setChatItems] = useState<ChatItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingFile, setIsProcessingFile] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<string | null>(null);
    const [aiMode, setAiMode] = useState<AiMode>('flash');
    const [geolocationStatus, setGeolocationStatus] = useState<'pending' | 'granted' | 'denied'>('pending');
    const [sessionContext, setSessionContext] = useState<{
        jurisdiction: Jurisdiction;
        timezone: string;
        location: { latitude: number; longitude: number; };
    } | null>(null);

    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<Set<string>>(new Set());
    
    const chatEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const addChatItem = useCallback((item: Omit<ChatItem, 'id' | 'timestamp'>) => {
        const newItem = { ...item, id: crypto.randomUUID(), timestamp: Date.now() };
        setChatItems(prev => [...prev, newItem as ChatItem]);
        return newItem.id;
    }, []);

    const updateMessageContent = useCallback((id: string, newContent: React.ReactNode, newSteps?: AnalysisStep[]) => {
        setChatItems(prev => prev.map(item => {
            if (item.id === id && item.type === 'message') {
                return { ...item, content: newContent, analysisSteps: newSteps || item.analysisSteps };
            }
            return item;
        }));
    }, []);
    
    useEffect(scrollToBottom, [chatItems]);
    
    const requestGeolocation = useCallback(() => {
        setGeolocationStatus('pending');
        setIsLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
                    const detectedJurisdiction = await getJurisdictionFromCoords(location);
                    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    setSessionContext({
                        jurisdiction: detectedJurisdiction,
                        timezone,
                        location
                    });
                    setGeolocationStatus('granted');
                } catch(e) {
                    console.error("Failed to determine jurisdiction from coordinates:", e);
                    setGeolocationStatus('denied'); // Treat API failure as denial
                }
            },
            (error) => {
                console.warn('Geolocation denied.', error.message);
                setGeolocationStatus('denied');
                 setSessionContext({
                    jurisdiction: 'Global',
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    location: { latitude: 0, longitude: 0 } // Default location
                });
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }, []);

    useEffect(() => {
        requestGeolocation();
    }, [requestGeolocation]);

    const loadInitialData = useCallback(async (context: NonNullable<typeof sessionContext>) => {
        setIsLoading(true);
        try {
            const { reports, evidence } = await getAllReportsIndexed();
            if (reports.length === 0) {
                 const welcomeMessage = `Hello and welcome to Verum Omnis Forensic Assistant. I'm here to help analyze digital evidence and uncover the truth.<br/><br/>Jurisdiction is auto-set to **${context.jurisdiction}**. All data remains on this device. Feel free to say hi, ask about the process, or upload your first piece of evidence whenever you're ready.`;
                 setChatItems([{
                    id: 'welcome-1',
                    type: 'message',
                    timestamp: Date.now(),
                    sender: 'assistant',
                    content: welcomeMessage
                }]);
            } else {
                const evidenceMap = new Map(evidence.map(e => [e.id, e]));
                const loadedItems: ReportItem[] = reports.reduce<ReportItem[]>((acc, report) => {
                    const primaryEvidenceRef = report.evidenceRefs.find(ref => evidenceMap.has(ref.id));
                    if (primaryEvidenceRef) {
                        acc.push({
                            id: report.id,
                            type: 'report',
                            timestamp: report.createdAt.getTime(),
                            report: report,
                            evidence: evidenceMap.get(primaryEvidenceRef.id)!,
                        });
                    }
                    return acc;
                }, []);
                setChatItems(loadedItems);
                 addChatItem({ type: 'message', sender: 'assistant', content: `Case context rebuilt from local storage. Jurisdiction: **${context.jurisdiction}**.` });
            }
        } catch (error) {
            console.error("Failed to load data from DB:", error);
            addChatItem({ type: 'message', sender: 'assistant', content: 'Could not load saved data. Starting a fresh session.' });
        } finally {
            setIsLoading(false);
        }
    }, [addChatItem]);


    useEffect(() => {
        if (sessionContext) {
            loadInitialData(sessionContext);
        }
    }, [sessionContext, loadInitialData]);
    
    const handleSendMessage = async (text: string) => {
        if (!text.trim() || !sessionContext) return;
        addChatItem({ type: 'message', sender: 'user', content: text, mode: aiMode, jurisdiction: sessionContext.jurisdiction });
        setIsLoading(true);

        const history = chatItems
            .filter(item => item.type === 'message')
            .map(item => {
                const msg = item as MessageItem;
                return {
                    role: msg.sender === 'user' ? 'user' as const : 'model' as const,
                    parts: [{ text: typeof msg.content === 'string' ? msg.content : `[Complex UI content]` }]
                };
            });
        
        try {
            const response = await getGeminiResponse(history, text, aiMode, sessionContext.jurisdiction);
            addChatItem({ type: 'message', sender: 'assistant', content: response, mode: aiMode, jurisdiction: sessionContext.jurisdiction });
        } catch (error) {
            console.error(error);
            addChatItem({ type: 'message', sender: 'assistant', content: 'Sorry, I ran into an error.', mode: aiMode, jurisdiction: sessionContext.jurisdiction });
        } finally {
            setIsLoading(false);
        }
    };
    
    const runAnalysisAndSaveReport = useCallback(async (evidence: Evidence) => {
        if (!sessionContext) return;
        setIsLoading(true);
        setIsProcessingFile(true);
        setProcessingStatus('Running AI analysis...');
        try {
            const analysisPromises = [
                generateSealedReportFromEvidence(evidence, sessionContext.jurisdiction, sessionContext.location),
                generateSealedReportFromEvidence(evidence, sessionContext.jurisdiction, sessionContext.location),
                generateSealedReportFromEvidence(evidence, sessionContext.jurisdiction, sessionContext.location),
            ];
            const results = await Promise.all(analysisPromises);
            const validResults = results.filter(r => r.data);

            if (validResults.length === 0) {
                 addChatItem({ type: 'message', sender: 'assistant', content: "Analysis was inconclusive. The AI could not generate a valid report for this evidence. Please try another file."});
                 return;
            }

            const primaryResult = validResults[0];
            const consensusCount = validResults.length;
            type VerificationStatus = 'Verified (3/3)' | 'Consensus (2/3)' | 'Inconclusive (≤1/3)';
            const verificationLabel: VerificationStatus = consensusCount === 3 ? 'Verified (3/3)' : (consensusCount === 2 ? 'Consensus (2/3)' : 'Inconclusive (≤1/3)');
            
            const reportData = primaryResult.data!;
            const findingsWithVerification = reportData.findings.map(f => ({ ...f, verification: verificationLabel }));

            const newReport = await saveReport({
                title: `Analysis of ${evidence.name}`,
                jurisdiction: sessionContext.jurisdiction,
                timezone: sessionContext.timezone,
                evidenceRefs: [{ id: evidence.id, sha512: evidence.sha512 }],
                findings: findingsWithVerification,
                contradictions: [],
                timeline: [],
                rawHtmlReport: reportData.reportHtml,
                highlights: reportData.highlights
            });

            addChatItem({ type: 'message', sender: 'assistant', content: `${primaryResult.intro || "Analysis complete."}\n\nReport saved with **${verificationLabel}** status.` });
            
            const newReportItem: ReportItem = {
                id: newReport.id,
                type: 'report',
                timestamp: newReport.createdAt.getTime(),
                report: newReport,
                evidence,
            };
            setChatItems(prev => [...prev, newReportItem]);

        } catch (error) {
            console.error("Report generation failed:", error);
            addChatItem({ type: 'message', sender: 'assistant', content: 'A critical error occurred during report generation.' });
        } finally {
            setIsLoading(false);
            setIsProcessingFile(false);
            setProcessingStatus(null);
        }
    }, [sessionContext, addChatItem]);

    const handleFileUpload = async (file: File) => {
        if (!sessionContext) return;
        
        setIsLoading(true);
        setIsProcessingFile(true);
        setProcessingStatus('Hashing file...');
        const hash = await calculateSHA512(file);
        const fileInfo: FileInfo = { name: file.name, type: file.type, size: file.size, hash };
        
        addChatItem({ type: 'message', sender: 'user', fileInfo, content: `File for analysis: ${file.name}` });
        addChatItem({ type: 'message', sender: 'assistant', content: `Got the file. Initiating forensic analysis now...\nFile fingerprint (SHA-512) computed for integrity verification.`});

        try {
            const evidence = await saveEvidence(file, sessionContext.jurisdiction, sessionContext.timezone);
            let textContent = '';
            
            if (file.type === 'application/pdf') {
                setProcessingStatus('Extracting PDF text...');
                textContent = await extractPdfText(file);
            }
            
            const isScanned = textContent.trim().length < 100;

            const triggerOcr = async () => {
                const ocrMsgId = addChatItem({ type: 'message', sender: 'assistant', content: 'Running local OCR... this may take a moment.' });
                setProcessingStatus('Running local OCR...');
                try {
                    const ocrText = await runOcr(file);
                    const updatedEvidence = { ...evidence, ocrText };
                    await updateEvidence(updatedEvidence);
                    updateMessageContent(ocrMsgId, `Local OCR complete. Extracted ${ocrText.length} characters.`);
                    await runAnalysisAndSaveReport(updatedEvidence);
                } catch(e) {
                    updateMessageContent(ocrMsgId, `Local OCR failed. Please check console for details.`);
                    console.error("OCR failed", e);
                    setIsLoading(false);
                    setIsProcessingFile(false);
                    setProcessingStatus(null);
                }
            };

            if (isScanned) {
                addChatItem({
                    type: 'action_request',
                    content: "This document appears to be a scanned image with little to no machine-readable text. For a more thorough analysis, I can perform Optical Character Recognition (OCR) locally on your device.",
                    actions: [
                        { label: 'Run Local OCR & Analyze', callback: triggerOcr },
                        { label: 'Analyze as Image Only', callback: () => runAnalysisAndSaveReport(evidence) }
                    ]
                });
                setIsLoading(false);
                setIsProcessingFile(false);
                setProcessingStatus(null);
            } else {
                 await runAnalysisAndSaveReport({ ...evidence, ocrText: textContent });
            }

        } catch (error) {
            console.error("File upload/processing failed:", error);
            addChatItem({ type: 'message', sender: 'assistant', content: 'Failed to save or analyze the evidence.' });
            setIsLoading(false);
            setIsProcessingFile(false);
            setProcessingStatus(null);
        }
    };
    
    const handleClearData = async (alsoDeleteMerged: boolean) => {
        await clearEvidenceAndReports({ alsoDeleteMerged });
        setChatItems([]);
        if (sessionContext) {
            loadInitialData(sessionContext);
        }
    };

    const handleToggleEvidenceSelection = (evidenceId: string) => {
        setSelectedEvidenceIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(evidenceId)) {
                newSet.delete(evidenceId);
            } else {
                newSet.add(evidenceId);
            }
            return newSet;
        });
    };
    
    const handleAnalyzeContradictions = async () => {
        if (selectedEvidenceIds.size < 2 || !sessionContext) return;
        
        addChatItem({ type: 'message', sender: 'user', content: `Analyzing ${selectedEvidenceIds.size} pieces of evidence for contradictions.` });
        setIsLoading(true);
        setProcessingStatus('Analyzing contradictions...');
        
        try {
            const { reports, evidence } = await getAllReportsIndexed();
            const selectedReports = reports.filter(r => r.evidenceRefs.some(ref => selectedEvidenceIds.has(ref.id)));

            if (selectedReports.length < 2) {
                addChatItem({ type: 'message', sender: 'assistant', content: "Please select at least two different reports to analyze for contradictions." });
                throw new Error("Insufficient reports selected for analysis.");
            }
            
            const contradictions = await runContradictionAnalysis(selectedReports, evidence);
            
            const evidenceRefs = selectedReports.flatMap(r => r.evidenceRefs);
            const uniqueEvidenceRefs = Array.from(new Map(evidenceRefs.map(item => [item.id, item])).values());

            const newReport = await saveReport({
                title: `Contradiction Analysis of ${selectedReports.length} reports`,
                jurisdiction: sessionContext.jurisdiction,
                timezone: sessionContext.timezone,
                evidenceRefs: uniqueEvidenceRefs,
                findings: [],
                contradictions: contradictions,
                timeline: [],
            });
            
            addChatItem({ type: 'message', sender: 'assistant', content: `Contradiction analysis complete. Found ${contradictions.length} potential contradictions. A new report has been generated.`});
            
            await loadInitialData(sessionContext);

        } catch(e) {
            // FIX: Safely handle 'unknown' error type in catch block.
            if (e instanceof Error) {
                console.error(`Failed to run contradiction analysis: ${e.stack}`);
                addChatItem({ type: 'message', sender: 'assistant', content: `Failed to run contradiction analysis. ${e.message}`});
            } else {
                console.error(`An unexpected error occurred during contradiction analysis: ${String(e)}`);
                addChatItem({ type: 'message', sender: 'assistant', content: 'Failed to run contradiction analysis.'});
            }
        } finally {
            setSelectedEvidenceIds(new Set());
            setIsLoading(false);
            setProcessingStatus(null);
        }
    };

    const handleMergeCaseFile = async () => {
        addChatItem({ type: 'message', sender: 'user', content: "Request to merge all reports into a single case file."});
        setIsLoading(true);
        setProcessingStatus("Generating case summary...");
        try {
            const pdfBlob = await mergeCaseFilePdf(setProcessingStatus);
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VerumOmnis-MergedCaseFile-${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            addChatItem({ type: 'message', sender: 'assistant', content: "Merged case file has been generated and downloaded."});

        } catch(e) {
             if (e instanceof Error) {
                console.error(`Failed to merge case file: ${e.stack}`);
                 addChatItem({ type: 'message', sender: 'assistant', content: `Failed to merge case file: ${e.message}`});
            } else {
                console.error(`An unexpected error occurred during case file merge: ${String(e)}`);
                 addChatItem({ type: 'message', sender: 'assistant', content: 'An unexpected error occurred during case file merge.'});
            }
        } finally {
            setIsLoading(false);
            setProcessingStatus(null);
        }
    };


    if (!sessionContext) {
        return (
            <div className="flex flex-col h-full bg-gray-950">
                <header className="flex items-center justify-between p-4 bg-gray-900/50 border-b border-gray-700 backdrop-blur-sm">
                    <div className="flex items-center space-x-3">
                        <svg className="w-8 h-8 text-blue-400" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#1f2937" stroke="#4b5563" strokeWidth="2"/><path d="M 50,15 A 35,35 0 1 1 50,85" fill="none" stroke="#e5e7eb" strokeWidth="4" strokeDasharray="5 5" transform="rotate(45 50 50)"/><path d="M 50,25 A 25,25 0 1 0 50,75" fill="none" stroke="#6b7280" strokeWidth="3"/><circle cx="50" cy="50" r="10" fill="#3b82f6"/></svg>
                        <div>
                            <h1 className="text-xl font-bold text-gray-100">Verum Omnis</h1>
                            <p className="text-xs text-gray-400">Forensic Integrity Protocol v5.2.7</p>
                        </div>
                    </div>
                </header>
                <div className="flex-1 flex items-center justify-center">
                    {geolocationStatus === 'denied' ? (
                        <GeolocationPermissionModal onRequest={requestGeolocation} />
                    ) : (
                        <div className="text-center">
                            <Icon icon="spinner" className="w-12 h-12 text-blue-500 mx-auto" />
                            <p className="mt-4 text-lg text-gray-300">Initializing secure session...</p>
                            <p className="text-sm text-gray-500">Awaiting geolocation for jurisdiction context.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const reportCount = chatItems.filter(item => item.type === 'report').length;

    return (
        <div className="flex flex-col h-full bg-gray-950">
            <ClearDataModal isOpen={isClearModalOpen} onClose={() => setIsClearModalOpen(false)} onConfirm={handleClearData} />
            <header className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-900/50 border-b border-gray-700 backdrop-blur-sm sticky top-0 z-10">
                <div className="flex items-center space-x-3">
                    <svg className="w-8 h-8 text-blue-400" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#1f2937" stroke="#4b5563" strokeWidth="2"/><path d="M 50,15 A 35,35 0 1 1 50,85" fill="none" stroke="#e5e7eb" strokeWidth="4" strokeDasharray="5 5" transform="rotate(45 50 50)"/><path d="M 50,25 A 25,25 0 1 0 50,75" fill="none" stroke="#6b7280" strokeWidth="3"/><circle cx="50" cy="50" r="10" fill="#3b82f6"/></svg>
                    <div>
                        <h1 className="text-xl font-bold text-gray-100">Verum Omnis</h1>
                        <p className="text-xs text-gray-400">Forensic Integrity Protocol v5.2.7</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="text-right">
                        <p className="text-sm font-semibold text-gray-200">{sessionContext.jurisdiction}</p>
                        <p className="text-xs text-gray-400">{sessionContext.timezone}</p>
                    </div>
                     {selectedEvidenceIds.size > 1 && (
                        <button onClick={handleAnalyzeContradictions} className="px-3 py-1.5 text-sm font-semibold text-white bg-yellow-600 rounded-md hover:bg-yellow-700 transition" disabled={isLoading}>
                            Analyze ({selectedEvidenceIds.size})
                        </button>
                    )}
                    {reportCount > 0 && (
                        <button onClick={handleMergeCaseFile} className="px-3 py-1.5 text-sm font-semibold text-white bg-green-700 rounded-md hover:bg-green-600 transition" disabled={isLoading}>
                            Merge Case
                        </button>
                    )}
                     <button onClick={() => setIsClearModalOpen(true)} className="px-3 py-1.5 text-sm font-semibold text-white bg-red-800 rounded-md hover:bg-red-700 transition" disabled={isLoading}>
                        Clear Case
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatItems.map(item => (
                    <ChatMessage 
                        key={item.id} 
                        item={item}
                        onToggleSelection={handleToggleEvidenceSelection}
                        isSelected={item.type === 'report' && selectedEvidenceIds.has(item.evidence.id)}
                    />
                ))}
                {(isLoading && !isProcessingFile) && (
                    <div className="flex justify-start">
                         <div className="p-4 rounded-2xl max-w-lg bg-gray-700 rounded-bl-none flex items-center space-x-3">
                            <Icon icon="spinner" className="w-6 h-6 text-blue-400" />
                            <p className="text-gray-300">Analyzing...</p>
                        </div>
                    </div>
                )}
                {isProcessingFile && processingStatus && (
                     <div className="flex justify-start">
                         <div className="p-4 rounded-2xl max-w-lg bg-gray-700 rounded-bl-none flex items-center space-x-3">
                            <Icon icon="spinner" className="w-6 h-6 text-blue-400" />
                            <p className="text-gray-300">{processingStatus}</p>
                        </div>
                    </div>
                )}
                <div ref={chatEndRef} />
            </main>

            <footer className="p-4 bg-gray-900 border-t border-gray-700 sticky bottom-0">
                <ChatInput 
                    onSend={handleSendMessage}
                    onFileChange={handleFileUpload}
                    isLoading={isLoading}
                    isProcessingFile={isProcessingFile}
                    aiMode={aiMode}
                    setAiMode={setAiMode}
                />
            </footer>
        </div>
    );
};

export default App;