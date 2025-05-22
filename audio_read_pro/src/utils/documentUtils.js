import { pdfjs } from 'react-pdf';
import mammoth from 'mammoth';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export const extractTextFromPDF = async (file) => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument(arrayBuffer).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n\n';
    }
    
    return { text: fullText, pageCount: pdf.numPages };
  } catch (error) {
    throw new Error('Error processing PDF: ' + error.message);
  }
};

export const extractTextFromDOCX = async (file) => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { text: result.value, pageCount: 1 }; // DOCX doesn't have built-in page count
  } catch (error) {
    throw new Error('Error processing DOCX: ' + error.message);
  }
};

export const extractTextFromTXT = async (file) => {
  try {
    const text = await file.text();
    return { text, pageCount: 1 }; // TXT files don't have pages
  } catch (error) {
    throw new Error('Error processing TXT: ' + error.message);
  }
};

export const processDocument = async (file) => {
  const fileType = file.name.split('.').pop().toLowerCase();
  
  switch (fileType) {
    case 'pdf':
      return await extractTextFromPDF(file);
    case 'docx':
      return await extractTextFromDOCX(file);
    case 'txt':
      return await extractTextFromTXT(file);
    default:
      throw new Error('Unsupported file format');
  }
};

export const splitTextIntoChunks = (text, maxChunkSize = 5000) => {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxChunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
};
