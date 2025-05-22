import { pdfjs } from 'react-pdf';
import mammoth from 'mammoth';

// PDF.js worker initialization is now handled in App.js

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

/**
 * Split document text into pages for better navigation
 * @param {string} text - The full text of the document
 * @param {number} pageCount - The actual page count from the document metadata
 * @param {number} avgWordsPerPage - Approximate words per page (for TXT/DOCX estimation)
 * @returns {Array} Array of page objects with text content and metadata
 */
export const splitTextIntoPages = (text, pageCount = 1, avgWordsPerPage = 500) => {
  // For PDFs with actual page count, we should try to honor the real page breaks
  if (pageCount > 1) {
    // Look for potential page breaks (double newlines or form feeds)
    const pageBreakPattern = /\n\s*\n|\f/g;
    const potentialBreaks = [...text.matchAll(pageBreakPattern)];
    
    // If we have enough breaks to make sensible pages
    if (potentialBreaks.length >= pageCount - 1) {
      const pages = [];
      let lastIndex = 0;
      
      // Create pages based on natural breaks in the document
      for (let i = 0; i < pageCount - 1; i++) {
        // Find a break point that would split the document into roughly equal pages
        const targetIndex = Math.round((i + 1) * potentialBreaks.length / pageCount) - 1;
        
        if (targetIndex >= 0 && targetIndex < potentialBreaks.length) {
          const breakIndex = potentialBreaks[targetIndex].index;
          pages.push({
            text: text.substring(lastIndex, breakIndex).trim(),
            pageNumber: i + 1
          });
          lastIndex = breakIndex;
        }
      }
      
      // Add the last page
      pages.push({
        text: text.substring(lastIndex).trim(),
        pageNumber: pageCount
      });
      
      return pages;
    }
  }
  
  // Fallback: Split by word count for documents without clear page structure
  const words = text.match(/\S+/g) || [];
  const wordsPerPage = words.length / pageCount;
  const pages = [];
  
  let currentPage = '';
  let currentWordCount = 0;
  let pageNumber = 1;
  
  // Split text into paragraphs
  const paragraphs = text.split(/\n\s*\n/);
  
  for (const paragraph of paragraphs) {
    const paragraphWordCount = (paragraph.match(/\S+/g) || []).length;
    
    // If adding this paragraph would exceed our word count per page and we already have content,
    // start a new page (unless this is the first paragraph on the page)
    if (currentPage && currentWordCount + paragraphWordCount > wordsPerPage) {
      pages.push({
        text: currentPage.trim(),
        pageNumber: pageNumber++
      });
      currentPage = paragraph;
      currentWordCount = paragraphWordCount;
    } else {
      currentPage += (currentPage ? '\n\n' : '') + paragraph;
      currentWordCount += paragraphWordCount;
    }
  }
  
  // Add the final page if it has content
  if (currentPage) {
    pages.push({
      text: currentPage.trim(),
      pageNumber: pageNumber
    });
  }
  
  return pages;
};

/**
 * Map text chunks to pages for synchronization between pages and audio
 * @param {Array} chunks - Array of text chunks
 * @param {Array} pages - Array of page objects
 * @returns {Object} Mapping between chunks and pages
 */
export const mapChunksToPages = (chunks, pages) => {
  const mapping = {
    chunkToPage: {}, // Map chunk index to page number
    pageToChunks: {} // Map page number to array of chunk indices
  };
  
  let chunkStartIndex = 0;
  
  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    mapping.pageToChunks[pageNumber] = [];
    
    let pageTextIndex = 0;
    const pageText = page.text;
    
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      
      // Check if this chunk starts within the current page text
      const chunkStartsInPage = pageText.indexOf(chunk, pageTextIndex) !== -1;
      
      if (chunkStartsInPage) {
        mapping.chunkToPage[chunkIndex] = pageNumber;
        mapping.pageToChunks[pageNumber].push(chunkIndex);
        pageTextIndex = pageText.indexOf(chunk, pageTextIndex) + chunk.length;
      }
      
      // If we've processed all text in this page, move to next page
      if (pageTextIndex >= pageText.length) {
        break;
      }
    }
  });
  
  // Ensure all chunks are assigned to a page (fallback)
  chunks.forEach((_, chunkIndex) => {
    if (!mapping.chunkToPage[chunkIndex]) {
      const estimatedPage = Math.ceil((chunkIndex + 1) * pages.length / chunks.length);
      const pageNumber = Math.min(estimatedPage, pages.length);
      
      mapping.chunkToPage[chunkIndex] = pageNumber;
      mapping.pageToChunks[pageNumber] = mapping.pageToChunks[pageNumber] || [];
      mapping.pageToChunks[pageNumber].push(chunkIndex);
    }
  });
  
  return mapping;
};
