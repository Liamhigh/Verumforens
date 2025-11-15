import React, { useState } from 'react';
import type { Finding, Jurisdiction } from '../types';
import { generateEmailFromFindings } from '../services/geminiService';
import Icon from './Icon';

interface EmailFindingsProps {
    findings: Finding[];
    jurisdiction: Jurisdiction;
}

const EmailFindings: React.FC<EmailFindingsProps> = ({ findings, jurisdiction }) => {
    const [recipientType, setRecipientType] = useState<'counsel' | 'adverse-party' | null>(null);
    const [recipientEmail, setRecipientEmail] = useState('');
    const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string; } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSent, setIsSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDraftEmail = async () => {
        if (!recipientType || !recipientEmail) return;
        setIsLoading(true);
        setError(null);
        setEmailDraft(null);

        try {
            const draft = await generateEmailFromFindings(findings, recipientType, jurisdiction);
            if (draft) {
                setEmailDraft(draft);
            } else {
                setError('Failed to generate email draft. The AI service may be unavailable.');
            }
        } catch (e) {
            setError('An unexpected error occurred while drafting the email.');
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSend = () => {
        if (!emailDraft || !recipientEmail) return;

        const subject = encodeURIComponent(emailDraft.subject);
        const body = encodeURIComponent(emailDraft.body);
        const mailtoLink = `mailto:${recipientEmail}?subject=${subject}&body=${body}`;

        // Trigger the default email client
        window.location.href = mailtoLink;

        // Still show the confirmation UI for feedback
        setIsSent(true);
        setTimeout(() => {
            setIsSent(false);
            setEmailDraft(null);
            setRecipientType(null);
            setRecipientEmail('');
        }, 5000);
    };

    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);

    if (isSent) {
        return (
            <div className="mt-6 p-4 rounded-lg bg-green-900/50 border border-green-700 flex items-center">
                <Icon icon="check" className="w-6 h-6 text-green-400 mr-3" />
                <div>
                    <h4 className="font-semibold text-green-300">Dispatching to Email Client</h4>
                    <p className="text-sm text-green-400">Your email draft has been opened in your default mail application.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="mt-6 p-4 rounded-lg bg-gray-800/50 border border-gray-600">
            <h3 className="font-bold text-lg text-gray-100 border-b border-gray-600 pb-2 mb-4">Post-Analysis Actions</h3>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">1. Select Recipient Type</label>
                    <div className="flex space-x-2">
                        <button
                            onClick={() => setRecipientType('counsel')}
                            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${recipientType === 'counsel' ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                        >
                            Legal Counsel
                        </button>
                        <button
                            onClick={() => setRecipientType('adverse-party')}
                            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${recipientType === 'adverse-party' ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                        >
                            Adverse Party
                        </button>
                    </div>
                </div>

                <div>
                    <label htmlFor="recipientEmail" className="block text-sm font-medium text-gray-300 mb-1">2. Recipient Email Address</label>
                    <input
                        type="email"
                        id="recipientEmail"
                        value={recipientEmail}
                        onChange={(e) => setRecipientEmail(e.target.value)}
                        placeholder="e.g., counsel@lawfirm.com"
                        className="w-full bg-gray-900/50 border border-gray-600 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                        disabled={!recipientType}
                    />
                </div>

                <button
                    onClick={handleDraftEmail}
                    disabled={!recipientType || !isEmailValid || isLoading}
                    className="w-full flex items-center justify-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed"
                >
                    {isLoading ? (
                        <>
                            <Icon icon="spinner" className="w-5 h-5 mr-2" />
                            Drafting Email...
                        </>
                    ) : '3. Draft Email Notification'}
                </button>

                {error && <p className="text-sm text-red-400 text-center">{error}</p>}
            </div>

            {emailDraft && !isLoading && (
                <div className="mt-6 border-t border-gray-600 pt-4 space-y-4">
                    <h4 className="font-semibold text-gray-200">Review Draft</h4>
                    <div>
                        <label htmlFor="emailSubject" className="block text-sm font-medium text-gray-300 mb-1">Subject</label>
                        <input
                            type="text"
                            id="emailSubject"
                            value={emailDraft.subject}
                            onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })}
                            className="w-full bg-gray-900/50 border border-gray-600 rounded-md px-3 py-2 text-sm"
                        />
                    </div>
                    <div>
                        <label htmlFor="emailBody" className="block text-sm font-medium text-gray-300 mb-1">Body</label>
                        <textarea
                            id="emailBody"
                            rows={10}
                            value={emailDraft.body}
                            onChange={(e) => setEmailDraft({ ...emailDraft, body: e.target.value })}
                            className="w-full bg-gray-900/50 border border-gray-600 rounded-md px-3 py-2 text-sm resize-y"
                        />
                    </div>
                    <button
                        onClick={handleSend}
                        className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Open In Email Client
                    </button>
                </div>
            )}
        </div>
    );
};

export default EmailFindings;
