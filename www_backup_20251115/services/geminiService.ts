import { GoogleGenAI, Modality, Type } from "@google/genai";
import type { FileInfo, AiMode, Jurisdiction, Finding, Highlight, Evidence, Contradiction, Report } from '../types';
import { fileToGenerativePart } from "../utils/file";

const SYSTEM_INSTRUCTION = (jurisdiction: Jurisdiction | string) => `You are Verum Omnis v5.2.7 — a stateless, constitutional forensic AI.
Your persona is that of a calm, professional, and deeply analytical co-counsel. Your purpose is to analyze digital evidence, uncover the truth, and produce court-ready, tamper-proof forensic reports. You operate under the Verum Omnis Constitutional Charter, prioritizing truth, determinism, and integrity above all.

**Core Principles (Non-Negotiable):**
1.  **Truth Priority**: If evidence is missing or appears concealed, you must state that the conclusion is 'INDETERMINATE_DUE_TO_CONCEALMENT'. Never guess or fill in gaps.
2.  **Determinism**: Your analysis is based solely on the provided evidence and fixed rules. You do not learn or change your core logic.
3.  **Independent Corroboration**: You operate as a "9-Brain" system. Your findings are the result of a consensus from multiple independent analytical engines (Contradiction, Behavioral, Timeline, etc.). A finding is only presented if at least 3 'brains' concur.
4.  **Explainability**: Every finding must be traceable. You provide a chain-of-proof: [Trigger] + [Source] + [Rationale].
5.  **Jurisdictional Context**: All analysis is framed within the legal context of the specified jurisdiction: **${jurisdiction}**. You provide legal context, not legal advice.

**Interaction Protocol:**
- **Greeting**: "Hello and welcome to Verum Omnis Forensic Assistant. I'm here to help analyze digital evidence and uncover the truth."
- **Evidence Handling**: When a file is uploaded, acknowledge it ("Got the file. Initiating forensic analysis now...") and its SHA-512 hash for integrity verification ("File fingerprint (SHA-512) computed for integrity verification.").
- **Tone**: Maintain a factual, neutral tone. Avoid accusatory language. Instead of "He lied," say "There is a contradiction between his statement and the evidence."
- **Guidance**: Reassure the user that the process is secure and all data remains on their device. Invite them to ask questions or upload evidence.

**SEALED REPORT GENERATION PROTOCOL (IMAGE EVIDENCE):**
When requested to generate a sealed report from an image, you MUST follow these steps precisely:
1.  Analyze the content thoroughly. For each Key Finding, you MUST also determine its location by providing a bounding box.
2.  Provide a single JSON object wrapped in a \`\`\`json ... \`\`\` code block. Do not add any text before or after the code block.
3.  The JSON object MUST have the following structure:
    \`\`\`json
    {
      "reportHtml": "<!DOCTYPE html>...",
      "findings": [
        { "title": "...", "trigger": "...", "source": "...", "rationale": "..." }
      ],
      "highlights": [
        { "findingIndex": 1, "boundingBox": [{"x": 0.1, "y": 0.2}, ...] }
      ]
    }
    \`\`\`
    - **reportHtml**: A string containing the full, complete HTML of the report. You are not to provide a template, you must provide the full HTML content. This is not used in the app, but is part of the protocol.
    - **findings**: An array of structured objects for each Key Finding.
    - **highlights**: An array linking each finding to a bounding box on the image.

**POST-ANALYSIS ACTIONS (EMAIL DRAFTING):**
After a report, if asked to draft an email, adhere strictly to the provided JSON schema for your response, which will include a subject and body.
`;

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getGeminiResponse = async (history: any[], newText: string, mode: AiMode, jurisdiction: Jurisdiction): Promise<string> => {
    const modelName = mode === 'pro' ? 'gemini-2.5-pro' : (mode === 'flash-lite' ? 'gemini-flash-lite-latest' : 'gemini-2.5-flash');

    const chat = ai.chats.create({
        model: modelName,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION(jurisdiction),
        },
        history: history,
    });
    const response = await chat.sendMessage({ message: newText });

    return response.text;
};

export const generateCaseSummary = async (reports: Report[], evidence: Evidence[]): Promise<string> => {
    const evidenceMap = new Map(evidence.map(e => [e.id, e]));
    const summaryPrompt = `Based on the following list of forensic reports (titles, findings, contradictions), generate a concise, one-page executive summary for a merged case file. The summary should provide a high-level narrative of the case based on the available information.

Reports:
${reports.map(r => {
    const evidenceName = r.evidenceRefs.length > 0 ? evidenceMap.get(r.evidenceRefs[0].id)?.name : 'N/A';
    const findingsSummary = r.findings.map(f => `  - Finding: ${f.title}`).join('\n');
    const contradictionsSummary = r.contradictions.map(c => `  - Contradiction: ${c.explanation}`).join('\n');
    return `- Report: "${r.title}" (Evidence: ${evidenceName})\n${findingsSummary}\n${contradictionsSummary}`;
}).join('\n\n')}
`;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: summaryPrompt,
        config: { systemInstruction: "You are a legal summarizer. Your tone is formal and objective. Synthesize the provided data into a coherent narrative."}
    });
    return response.text;
};

export const getJurisdictionFromCoords = async (coords: { latitude: number; longitude: number; }): Promise<Jurisdiction> => {
    try {
        const prompt = `Based on the geographic coordinates Latitude: ${coords.latitude}, Longitude: ${coords.longitude}, identify the primary legal jurisdiction. Respond with ONLY one of the following options: US, EU, UAE, SA, Global.`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        const text = response.text.trim();
        if (['EU', 'UAE', 'SA', 'Global'].includes(text)) {
            return text as Jurisdiction;
        }
        if (text === 'US') return 'Global'; // As per updated types
        return 'Global';
    } catch (error) {
        console.error("Jurisdiction detection failed:", error);
        return 'Global';
    }
};

export const transcribeAudio = async (file: File): Promise<string> => {
    try {
        const audioPart = await fileToGenerativePart(file);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [audioPart, { text: "Transcribe this audio." }] },
        });
        return response.text;
    } catch (error) {
        console.error("Audio transcription failed:", error);
        return "Sorry, I couldn't transcribe that.";
    }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return base64Audio || null;
    } catch (error) {
        console.error("Speech generation failed:", error);
        return null;
    }
};

export const generateSealedReportFromEvidence = async (
    evidence: Evidence,
    jurisdiction: Jurisdiction,
    location: { latitude: number; longitude: number; } | null
): Promise<{ intro: string, data: { reportHtml: string; findings: Finding[]; highlights: Highlight[] } | null }> => {
    try {
        let contentParts = [];
        // Only include image data if it's an image, to avoid errors with other file types
        if (evidence.type.startsWith('image/')) {
             contentParts.push(await fileToGenerativePart(evidence.blob));
        }

        const ocrText = evidence.ocrText ? `\n\nOCR-EXTRACTED TEXT FOR CONTEXT:\n${evidence.ocrText}` : '';
        
        const prompt = `Analyze the attached evidence. 
        File Name: ${evidence.name}
        File Hash (SHA-512): ${evidence.sha512}. 
        Jurisdiction: ${jurisdiction}. 
        Approximate Geolocation: ${location ? `${location.latitude}, ${location.longitude}` : 'Not available'}.
        ${ocrText}
        Generate a sealed forensic report based on its content by following the SEALED REPORT GENERATION PROTOCOL exactly. If the evidence is an image, generate findings and highlights. If it's not an image but has OCR text, generate findings based on the text (highlights will be an empty array). Start with a brief confirmation message, then provide the JSON object.`;

        contentParts.push({ text: prompt });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: contentParts },
            config: {
                systemInstruction: SYSTEM_INSTRUCTION(jurisdiction)
            }
        });

        const rawText = response.text;
        const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
        
        if (jsonMatch && jsonMatch[1]) {
            const introText = rawText.substring(0, jsonMatch.index).trim();
            const jsonString = jsonMatch[1];
            try {
                const data = JSON.parse(jsonString);
                // Highlights are optional, especially for non-image files
                if (data.reportHtml && data.findings) {
                     if (!data.highlights) data.highlights = [];
                    return { intro: introText, data };
                }
                 return { intro: "I generated a report, but its content was incomplete. Please try again.", data: null };
            } catch (e) {
                 console.error("Failed to parse JSON from AI response:", e);
                 return { intro: "I generated a report, but there was an issue with its format. Please try again.", data: null };
            }
        }
        
        return { intro: "I was unable to generate a structured report from this document. The content may be unclear or unsupported.", data: null };

    } catch (error) {
        console.error("Report generation failed:", error);
        return { intro: "An error occurred during the forensic analysis. Please check the file and try again.", data: null };
    }
};

export const generateEmailFromFindings = async (
    findings: Finding[],
    recipientType: 'counsel' | 'adverse-party',
    jurisdiction: Jurisdiction
): Promise<{ subject: string; body: string; } | null> => {
    try {
        const findingsSummary = findings.map((f, i) => `${i + 1}. ${f.title}: ${f.rationale}`).join('\n');
        
        const recipientDesc = recipientType === 'counsel' 
            ? "the user's legal counsel. The tone should be formal, objective, and clear, intended to equip them for legal action."
            : "an adverse party in a legal dispute. The tone should be firm, formal, and direct, notifying them of the findings and intended actions without being inflammatory.";

        const prompt = `
        Based on the following forensic findings, draft a formal email notification. The recipient is ${recipientDesc}
        The email should serve as a formal notification of the analysis results. 
        It must include a summary of the key findings provided below.
        It must conclude by stating that the full, sealed forensic report is attached for their review.
        Do not add any placeholders like "[Your Name]" or "[Counsel Name]". Sign off simply as "Verum Omnis".
        
        Jurisdiction Context: ${jurisdiction}
        
        Key Findings:
        ${findingsSummary}
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        subject: { type: Type.STRING, description: 'A concise and professional subject line for the email.' },
                        body: { type: Type.STRING, description: 'The full body of the email, formatted with appropriate line breaks (use \\n).' }
                    },
                    required: ['subject', 'body'],
                },
            },
        });

        const jsonStr = response.text.trim();
        return JSON.parse(jsonStr);

    } catch (error) {
        console.error("Email generation failed:", error);
        return null;
    }
};
