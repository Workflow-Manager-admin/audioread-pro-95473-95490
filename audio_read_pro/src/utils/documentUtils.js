import { pdfjs } from 'react-pdf';
import mammoth from 'mammoth';

// PDF.js worker initialization is now handled in App.js

export const extractTextFromPDF = async (file) => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument(arrayBuffer).promise;
    let fullText = '';
    
    // Try to preserve natural page breaks from PDF
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n\n';
      
      // Add a special page break marker if not the last page
      if (i < pdf.numPages) {
        fullText += '<!-- PAGE_BREAK -->\n';
      }
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

/**
 * Count words in a string
 * @param {string} text - Text to count words in
 * @returns {number} Word count
 */
export const countWords = (text) => {
  return (text.match(/\S+/g) || []).length;
};

/**
 * Split document text into chunks for speech synthesis
 * @param {string} text - The document text
 * @param {number} maxChunkSize - Maximum size of each chunk in characters
 * @returns {Array} Array of text chunks
 */
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
 * Split document text into true book-like pages for better navigation
 * @param {string} text - The full text of the document
 * @param {number} pageCount - The suggested page count from the document metadata
 * @param {number} wordsPerPage - Target words per page for consistent sizing
 * @returns {Array} Array of page objects with text content, metadata and position info
 */
export const splitTextIntoPages = (text, pageCount = 1, wordsPerPage = 300) => {
  // Check for PDF-specific page break markers
  const pdfPageBreaks = text.includes('<!-- PAGE_BREAK -->');
  
  if (pdfPageBreaks) {
    // For PDFs, respect the natural page breaks
    const pdfPages = text.split('<!-- PAGE_BREAK -->');
    return pdfPages.map((pageText, index) => {
      const cleanText = pageText.trim();
      // Calculate start and end character positions
      const startPos = index === 0 ? 0 : 
        text.indexOf('<!-- PAGE_BREAK -->', 
          index === 1 ? 0 : 
          text.indexOf('<!-- PAGE_BREAK -->', calculatePrevPageBreakPos(text, index - 1)) + 15) + 15;
      
      // For page content tracking
      const wordCount = countWords(cleanText);
      
      return {
        text: cleanText,
        pageNumber: index + 1,
        startPosition: startPos,
        endPosition: startPos + cleanText.length,
        wordCount
      };
    });
  }
  
  // For non-PDF documents, create consistent pages based on word count
  const paragraphs = text.split(/\n\s*\n/);
  const pages = [];
  let currentPage = '';
  let currentWordCount = 0;
  let pageNumber = 1;
  let startPosition = 0;
  
  // Calculate total word count for the document to determine optimal page sizing
  const totalWordCount = countWords(text);
  
  // If user provided a page count, adjust words per page to match it closely
  if (pageCount > 1) {
    wordsPerPage = Math.max(100, Math.ceil(totalWordCount / pageCount));
  } else {
    // Calculate a reasonable page count based on total words
    pageCount = Math.max(1, Math.ceil(totalWordCount / wordsPerPage));
  }
  
  for (const paragraph of paragraphs) {
    // Clean up paragraph and count words
    const cleanParagraph = paragraph.trim();
    if (!cleanParagraph) continue;
    
    const paragraphWordCount = countWords(cleanParagraph);
    
    // Check if adding this paragraph would exceed our target words per page
    if (currentPage && currentWordCount + paragraphWordCount > wordsPerPage) {
      // Complete current page
      const pageText = currentPage.trim();
      pages.push({
        text: pageText,
        pageNumber: pageNumber,
        startPosition: startPosition,
        endPosition: startPosition + pageText.length,
        wordCount: currentWordCount
      });
      
      // Start a new page
      pageNumber++;
      currentPage = cleanParagraph;
      currentWordCount = paragraphWordCount;
      startPosition = text.indexOf(cleanParagraph, startPosition + pageText.length);
    } else {
      // Add paragraph to current page
      currentPage += (currentPage ? '\n\n' : '') + cleanParagraph;
      currentWordCount += paragraphWordCount;
      
      // Set initial start position if this is the first paragraph
      if (startPosition === 0 && pages.length === 0) {
        startPosition = text.indexOf(cleanParagraph);
      }
    }
  }
  
  // Add the final page if it has content
  if (currentPage) {
    const pageText = currentPage.trim();
    pages.push({
      text: pageText,
      pageNumber: pageNumber,
      startPosition: startPosition,
      endPosition: startPosition + pageText.length,
      wordCount: currentWordCount
    });
  }
  
  return pages;
};

/**
 * Helper function to calculate the position of a specific page break
 */
function calculatePrevPageBreakPos(text, pageIndex) {
  let pos = 0;
  for (let i = 0; i < pageIndex; i++) {
    pos = text.indexOf('<!-- PAGE_BREAK -->', pos) + 15;
  }
  return pos;
}

/**
 * Map text chunks to pages for synchronization between pages and audio
 * Enhanced with precise character position tracking
 * @param {Array} chunks - Array of text chunks
 * @param {Array} pages - Array of page objects with position information
 * @returns {Object} Mapping between chunks and pages with additional metadata
 */
export const mapChunksToPages = (chunks, pages) => {
  const mapping = {
    chunkToPage: {}, // Map chunk index to page number
    pageToChunks: {}, // Map page number to array of chunk indices
    chunkPositions: {}, // Store character positions for each chunk
    pagePositions: {} // Store character positions for each page
  };
  
  if (!chunks.length || !pages.length) {
    return mapping;
  }
  
  // Initialize page to chunks mapping
  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    mapping.pageToChunks[pageNumber] = [];
    mapping.pagePositions[pageNumber] = {
      start: page.startPosition,
      end: page.endPosition,
      wordCount: page.wordCount
    };
  });
  
  // Calculate character positions for each chunk
  let totalCharCount = 0;
  chunks.forEach((chunk, chunkIndex) => {
    const chunkLength = chunk.length;
    mapping.chunkPositions[chunkIndex] = {
      start: totalCharCount,
      end: totalCharCount + chunkLength,
      length: chunkLength
    };
    totalCharCount += chunkLength;
  });
  
  // Map chunks to pages based on character positions
  chunks.forEach((chunk, chunkIndex) => {
    const chunkStart = mapping.chunkPositions[chunkIndex].start;
    const chunkEnd = mapping.chunkPositions[chunkIndex].end;
    
    // Find which page this chunk mostly belongs to
    let bestMatchPage = 1;
    let maxOverlap = 0;
    
    pages.forEach((page, pageIndex) => {
      const pageNumber = pageIndex + 1;
      const pageStart = mapping.pagePositions[pageNumber].start;
      const pageEnd = mapping.pagePositions[pageNumber].end;
      
      // Calculate the overlap between chunk and page
      const overlapStart = Math.max(chunkStart, pageStart);
      const overlapEnd = Math.min(chunkEnd, pageEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestMatchPage = pageNumber;
      }
    });
    
    // Assign chunk to the best matching page
    mapping.chunkToPage[chunkIndex] = bestMatchPage;
    mapping.pageToChunks[bestMatchPage].push(chunkIndex);
  });
  
  return mapping;
};

/**
 * Get the page and position information for a specific character offset
 * @param {number} charOffset - Character offset in the document
 * @param {Object} mapping - The chunk-to-page mapping
 * @param {Array} pages - Array of page objects
 * @returns {Object} Page and position information
 */
export const getPositionInfo = (charOffset, mapping, pages) => {
  // Find which page contains this character position
  const pageNumber = pages.findIndex(page => 
    charOffset >= page.startPosition && charOffset <= page.endPosition
  ) + 1;
  
  if (pageNumber === 0) {
    // If not found, default to first page
    return { pageNumber: 1, offset: 0 };
  }
  
  // Calculate the relative offset within the page
  const pageStartPos = pages[pageNumber - 1].startPosition;
  const relativeOffset = charOffset - pageStartPos;
  
  return {
    pageNumber,
    offset: relativeOffset
  };
};

/**
 * Find which chunk contains a specific character position
 * @param {number} charPosition - Character position in the full text
 * @param {Array} chunks - Array of text chunks
 * @returns {Object} Chunk index and relative position information
 */
export const findChunkByPosition = (charPosition, chunks) => {
  let accumulatedLength = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkEnd = accumulatedLength + chunks[i].length;
    if (charPosition >= accumulatedLength && charPosition < chunkEnd) {
      return {
        chunkIndex: i,
        relativePosition: charPosition - accumulatedLength
      };
    }
    accumulatedLength = chunkEnd;
  }
  
  // If not found, return the last chunk
  return {
    chunkIndex: chunks.length - 1,
    relativePosition: 0
  };
};
