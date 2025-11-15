import React, { useState, useRef, ChangeEvent } from 'react';
import Icon from './Icon';
import { transcribeAudio } from '../services/geminiService';
import type { AiMode } from '../types';

interface ChatInputProps {
    onSend: (text: string) => void;
    onFileChange: (file: File) => void;
    isLoading: boolean;
    isProcessingFile: boolean;
    aiMode: AiMode;
    setAiMode: (mode: AiMode) => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSend, onFileChange, isLoading, isProcessingFile, aiMode, setAiMode }) => {
    const [text, setText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const handleSend = () => {
        if (text.trim() && !isLoading) {
            onSend(text);
            setText('');
        }
    };

    const handleFileClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            onFileChange(file);
        }
        event.target.value = ''; // Reset for same-file uploads
    };

    const handleMicClick = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorderRef.current = new MediaRecorder(stream);
                mediaRecorderRef.current.ondataavailable = (event) => {
                    audioChunksRef.current.push(event.data);
                };
                mediaRecorderRef.current.onstop = async () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    const audioFile = new File([audioBlob], "recording.webm", { type: "audio/webm" });
                    audioChunksRef.current = [];
                    setIsRecording(false);
                    const transcribedText = await transcribeAudio(audioFile);
                    setText(prev => prev ? `${prev} ${transcribedText}` : transcribedText);
                };
                mediaRecorderRef.current.start();
                setIsRecording(true);
            } catch (error) {
                console.error("Microphone access denied or not available", error);
                alert("Microphone access is required for this feature.");
            }
        }
    };

    return (
        <div>
            <div className="relative flex items-center bg-gray-800 rounded-lg p-2 border border-gray-700 focus-within:ring-2 focus-within:ring-blue-500 transition-shadow overflow-hidden">
                {isProcessingFile && (
                    <div className="absolute top-0 left-0 w-full h-[3px] bg-blue-500/20">
                        <div className="h-full bg-blue-500 animate-progress-indeterminate rounded-full"></div>
                    </div>
                )}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelected}
                    className="hidden"
                    aria-hidden="true"
                />
                <button onClick={handleFileClick} className="p-2 text-gray-400 hover:text-white transition-colors" aria-label="Attach file" disabled={isLoading}>
                    <Icon icon="paperclip" className="w-6 h-6" />
                </button>
                <button onClick={handleMicClick} className={`p-2 transition-colors ${isRecording ? 'text-red-500 animate-pulse' : 'text-gray-400 hover:text-white'}`} aria-label={isRecording ? 'Stop recording' : 'Start recording'} disabled={isLoading}>
                    <Icon icon="microphone" className="w-6 h-6" />
                </button>
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                    placeholder={isProcessingFile ? "Processing evidence..." : "Ask a question or upload evidence..."}
                    className="flex-1 bg-transparent px-4 py-2 text-gray-200 placeholder-gray-500 focus:outline-none"
                    disabled={isLoading}
                />
                <button onClick={handleSend} disabled={isLoading || !text.trim()} className="p-2 text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors" aria-label="Send message">
                    <Icon icon="send" className="w-6 h-6" />
                </button>
            </div>
            <div className="flex justify-center items-center mt-2 space-x-2 text-xs text-gray-400">
                <span>Mode:</span>
                <button onClick={() => setAiMode('flash-lite')} className={`px-2 py-1 rounded ${aiMode === 'flash-lite' ? 'bg-green-600/50 text-green-300' : 'hover:bg-gray-700'}`}>Fast</button>
                <button onClick={() => setAiMode('flash')} className={`px-2 py-1 rounded ${aiMode === 'flash' ? 'bg-blue-600/50 text-blue-300' : 'hover:bg-gray-700'}`}>Normal</button>
                <button onClick={() => setAiMode('pro')} className={`px-2 py-1 rounded flex items-center ${aiMode === 'pro' ? 'bg-purple-600/50 text-purple-300' : 'hover:bg-gray-700'}`}>
                    <Icon icon="brain" className="w-3 h-3 mr-1"/>Thinking
                </button>
            </div>
        </div>
    );
};

export default ChatInput;
