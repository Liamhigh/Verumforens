import type React from 'react';

export type AiMode = 'flash' | 'flash-lite' | 'pro';
export type Jurisdiction = 'Global' | 'UAE' | 'SA' | 'EU';
export type AnalysisStatus = 'pending' | 'in-progress' | 'complete' | 'error';

// --- Database Models ---

export interface Evidence {
  id: string; // uuid
  name: string;
  size: number;
  type: string; // MIME type
  blob: File;
  sha512: string;
  createdAt: Date;
  jurisdiction: Jurisdiction;
  timezone: string;
  meta: Record<string, any>; // EXIF data, etc.
  ocrText?: string;
}

export interface Report {
  id: string; // uuid
  title: string;
  chapterIndex: number;
  createdAt: Date;
  updatedAt: Date;
  jurisdiction: Jurisdiction;
  timezone: string;
  evidenceRefs: { id: string; sha512: string }[];
  findings: Finding[];
  contradictions: Contradiction[];
  timeline: TimelineEvent[];
  pdfSha512?: string;
  rawHtmlReport?: string; // Storing the AI-generated HTML
  highlights?: Highlight[]; // Storing AI-generated highlights
}

export interface ReportsIndexMeta {
  key: 'reports_index';
  order: string[]; // Array of report IDs
  lastChapterIndex: number;
}

// --- Content and Analysis Types ---

export interface Finding {
  title: string;
  trigger: string;
  source: string;
  rationale: string;
  verification?: 'Verified (3/3)' | 'Consensus (2/3)' | 'Inconclusive (≤1/3)';
}

export interface Contradiction {
    type: 'direct' | 'metadata_mismatch' | 'cross_doc_drift' | 'omission';
    actor?: string;
    claimA?: string;
    claimB?: string;
    sources: string[]; // evidence IDs
    explanation: string;
    verification: 'Verified (3/3)' | 'Consensus (2/3)' | 'Inconclusive (≤1/3)';
}

export interface TimelineEvent {
    date: string; // ISO 8601 format
    event: string;
    sources: string[]; // evidence IDs
}

export interface BoundingBoxVertex {
  x: number;
  y: number;
}

export interface Highlight {
  findingIndex: number; // Corresponds to the 1-based index of the finding
  boundingBox: BoundingBoxVertex[];
}

// --- UI and Message Types ---

export interface FileInfo {
  name: string;
  type: string;
  size: number;
  hash?: string;
}

export interface AnalysisStep {
  title: string;
  status: AnalysisStatus;
  details?: string;
  result?: string;
}

export interface ChatItemBase {
  id: string;
  timestamp: number;
}
export interface MessageItem extends ChatItemBase {
  type: 'message';
  sender: 'user' | 'assistant';
  content: React.ReactNode;
  fileInfo?: FileInfo;
  analysisSteps?: AnalysisStep[];
  mode?: AiMode;
  jurisdiction?: Jurisdiction;
}

export interface ReportItem extends ChatItemBase {
    type: 'report';
    report: Report;
    evidence: Evidence; // The primary evidence for this report
}

export interface ActionRequestItem extends ChatItemBase {
  type: 'action_request';
  content: string;
  actions: { label: string, callback: () => void }[];
}


export type ChatItem = MessageItem | ReportItem | ActionRequestItem;


// In-memory representation of the case
export interface CaseContext {
    timeline: TimelineEvent[];
    entities: Record<string, any>;
    contradictionIndex: Contradiction[];
    unresolvedIssues: string[];
}
