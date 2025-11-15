// Tesseract is loaded from a script tag in index.html and will be on the window object.
declare const Tesseract: any;

export const runOcr = async (file: File): Promise<string> => {
    if (typeof Tesseract === 'undefined') {
        throw new Error("Tesseract.js not loaded. Please ensure you are online for the first run so it can be cached.");
    }

    const worker = await Tesseract.createWorker('eng');
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    return text;
};
