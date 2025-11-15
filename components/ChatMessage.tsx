import React, { useState } from 'react';
import type { ChatItem, MessageItem, ReportItem, AnalysisStep, ActionRequestItem, Evidence, Contradiction } from '../types';
import Icon from './Icon';
import { generateSpeech } from '../services/geminiService';
import { playAudio } from '../utils/audio';
import EvidenceViewer from './EvidenceViewer';
import EmailFindings from './EmailFindings';
import { generateSealedPdf } from '../services/forensicService';

const getFileIcon = (fileType: string): React.ReactElement => {
    if (fileType.startsWith('image/')) {
        return <Icon icon="image" className="w-8 h-8 text-blue-400" />;
    }
    if (fileType.startsWith('application/pdf')) {
        return <Icon icon="document" className="w-8 h-8 text-red-400" />;
    }
    return <Icon icon="file" className="w-8 h-8 text-gray-400" />;
};

const FilePreview: React.FC<{ fileInfo: MessageItem['fileInfo'] }> = ({ fileInfo }) => {
    if (!fileInfo) return null;
    return (
        <div className="mt-2 flex items-center bg-gray-700/50 rounded-lg p-3 border border-gray-600">
            {getFileIcon(fileInfo.type)}
            <div className="ml-3 overflow-hidden">
                <p className="text-sm font-medium truncate text-gray-200">{fileInfo.name}</p>
                <p className="text-xs text-gray-400">{(fileInfo.size / 1024).toFixed(2)} KB</p>
                {fileInfo.hash && <p className="text-xs text-mono text-gray-500 mt-1">SHA-512: {fileInfo.hash.substring(0, 16)}...</p>}
            </div>
        </div>
    );
};

const AnalysisStepsDisplay: React.FC<{ steps: AnalysisStep[] }> = ({ steps }) => {
    const getStatusIcon = (status: AnalysisStep['status']) => {
        switch(status) {
            case 'complete': return <Icon icon="check" className="w-5 h-5 text-green-400" />;
            case 'in-progress': return <Icon icon="spinner" className="w-5 h-5 text-blue-400" />;
            case 'pending': return <div className="w-5 h-5"><div className="w-2 h-2 mt-1.5 ml-1.5 rounded-full bg-gray-500"></div></div>;
            case 'error': return <p>X</p>
        }
    }
    return (
        <div className="mt-3 space-y-3">
            {steps.map(step => (
                <div key={step.title} className="flex items-start text-sm">
                    <div className="w-6 h-6 flex-shrink-0">{getStatusIcon(step.status)}</div>
                    <div className="ml-2">
                        <p className="font-semibold text-gray-300">{step.title}</p>
                        {step.details && <p className="text-xs text-gray-400">{step.details}</p>}
                    </div>
                </div>
            ))}
        </div>
    )
};

const PdfExportButton: React.FC<{ report: ReportItem['report'], evidence: Evidence }> = ({ report, evidence }) => {
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState('');

    const handleExport = async () => {
        setIsExporting(true);
        setExportError('');
        try {
            const pdfBlob = await generateSealedPdf(report, evidence);
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VerumOmnis-Report-${report.id.substring(0,8)}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export PDF:', error);
            setExportError('An unexpected error occurred while generating the report.');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="mt-4 w-full sm:w-auto">
            <button
                onClick={handleExport}
                disabled={isExporting}
                className="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-500 w-full sm:w-auto"
            >
                {isExporting ? (
                    <>
                        <Icon icon="spinner" className="w-5 h-5 mr-2" />
                        Sealing PDF...
                    </>
                ) : (
                    <>
                        <Icon icon="document" className="w-5 h-5 mr-2" />
                        Download Sealed Report
                    </>
                )}
            </button>
            {exportError && <p className="text-sm text-red-400 mt-2 text-center sm:text-left">{exportError}</p>}
        </div>
    );
};

const ContradictionDisplay: React.FC<{ contradiction: Contradiction }> = ({ contradiction }) => {
    return (
         <div className="p-3 rounded-lg bg-red-900/20 ring-1 ring-red-500/30">
            <h5 className="font-semibold text-base text-red-300">Contradiction: {contradiction.type}</h5>
            <p className="my-1"><strong>Explanation:</strong> {contradiction.explanation}</p>
            <p className="text-xs text-gray-400"><strong>Sources:</strong> {contradiction.sources.map(s => s.substring(0,8)).join(', ')}</p>
        </div>
    )
}

const ReportDisplay: React.FC<{ item: ReportItem, onToggleSelection: (evidenceId: string) => void, isSelected: boolean }> = ({ item, onToggleSelection, isSelected }) => {
    const { report, evidence } = item;
    const [hoveredFinding, setHoveredFinding] = useState<number | null>(null);

    const hasImageEvidence = evidence?.type.startsWith('image/');

    if (!evidence) {
        return <p className="text-red-400">Error: Evidence for this report could not be loaded.</p>;
    }

    return (
        <div className="mt-1">
            <div className="flex items-center justify-between">
                 <h3 className="font-bold text-lg text-gray-100">{report.title}</h3>
                 <label className="flex items-center space-x-2 text-xs text-gray-400 cursor-pointer">
                    <span>Select for Analysis</span>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggleSelection(evidence.id)} className="h-4 w-4 bg-gray-800 border-gray-600 text-blue-500 focus:ring-blue-500 rounded"/>
                 </label>
            </div>
           
            <div className={`grid grid-cols-1 ${hasImageEvidence ? 'xl:grid-cols-2' : ''} gap-6 bg-gray-800/50 p-4 rounded-lg border border-gray-600 mt-2`}>
                {hasImageEvidence && (
                    <div className="max-h-[70vh] overflow-auto rounded-md">
                        <EvidenceViewer
                            file={evidence.blob}
                            highlights={report.highlights || []}
                            hoveredFinding={hoveredFinding}
                            onHover={setHoveredFinding}
                        />
                    </div>
                )}
                <div className="prose prose-invert prose-sm max-h-[70vh] overflow-y-auto pr-2">
                    {report.findings.length > 0 && <h4 className="font-bold text-base text-gray-100 border-b border-gray-600 pb-2 mb-3">Key Findings</h4>}
                    {report.findings.map((finding, index) => (
                        <div
                            key={index}
                            className={`p-3 rounded-lg transition-colors duration-200 ${hoveredFinding === (index + 1) ? 'bg-blue-900/40 ring-1 ring-blue-500' : ''}`}
                            onMouseEnter={() => setHoveredFinding(index + 1)}
                            onMouseLeave={() => setHoveredFinding(null)}
                        >
                            <h5 className="font-semibold text-base text-blue-300">Finding {index + 1}: {finding.title}</h5>
                             {finding.verification && <p className="text-xs font-bold text-green-300">{finding.verification}</p>}
                            <p className="my-1"><strong>Rationale:</strong> {finding.rationale}</p>
                        </div>
                    ))}

                    {report.contradictions.length > 0 && <h4 className="font-bold text-base text-gray-100 border-b border-gray-600 pb-2 my-3">Contradictions</h4>}
                    {report.contradictions.map((c, index) => <ContradictionDisplay key={index} contradiction={c} />)}
                </div>
            </div>
            <PdfExportButton report={report} evidence={evidence} />
            {report.findings.length > 0 && <EmailFindings findings={report.findings} jurisdiction={report.jurisdiction} />}
        </div>
    );
};

const ActionRequestDisplay: React.FC<{item: ActionRequestItem}> = ({ item }) => {
    return (
        <div>
            <p className="prose prose-invert prose-sm">{item.content}</p>
            <div className="flex space-x-2 mt-3">
                {item.actions.map(action => (
                    <button key={action.label} onClick={action.callback} className="px-3 py-1.5 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition">
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

const ChatMessage: React.FC<{ item: ChatItem; onToggleSelection: (id: string) => void; isSelected: boolean; }> = ({ item, onToggleSelection, isSelected }) => {
    
    const renderContent = () => {
        switch(item.type) {
            case 'report':
                return <ReportDisplay item={item} onToggleSelection={onToggleSelection} isSelected={isSelected} />;
            case 'action_request':
                return <ActionRequestDisplay item={item} />;
            case 'message':
            default:
                 const msg = item as MessageItem;
                 return (
                    <>
                        {typeof msg.content === 'string' ? (
                            <div className="prose prose-invert prose-sm" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br />') }} />
                        ) : (
                            <div>{msg.content}</div>
                        )}
                        {msg.fileInfo && <FilePreview fileInfo={msg.fileInfo} />}
                        {msg.analysisSteps && <AnalysisStepsDisplay steps={msg.analysisSteps} />}
                    </>
                 );
        }
    }

    const isUser = item.type === 'message' && item.sender === 'user';

    const handleTTS = async () => {
      if (item.type === 'message' && typeof item.content === 'string') {
        const audioData = await generateSpeech(item.content as string);
        if (audioData) playAudio(audioData);
      }
    }

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} message-bubble`}>
            <div className={`p-4 rounded-2xl max-w-lg lg:max-w-4xl ${isUser ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
                
                {renderContent()}

                {!isUser && item.type === 'message' && typeof item.content === 'string' && (
                    <div className="flex justify-end items-center mt-2">
                         {item.jurisdiction && <span className="text-xs text-gray-500 mr-2 uppercase">{item.jurisdiction}</span>}
                         {item.mode && <span className="text-xs text-gray-500 mr-2 uppercase">{item.mode}</span>}
                        <button onClick={handleTTS} className="text-gray-400 hover:text-white transition-colors">
                            <Icon icon="speaker" className="w-5 h-5"/>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatMessage;