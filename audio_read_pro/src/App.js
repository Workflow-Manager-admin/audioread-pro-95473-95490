import React, { useState, useEffect, useRef, useCallback } from 'react';
import useSpeechSynthesis from './hooks/useSpeechSynthesis';
import useDocumentLibrary from './hooks/useDocumentLibrary';
import DocumentLibrary from './components/DocumentLibrary';
import { FaPlay, FaPause, FaForward, FaBackward, FaBookmark } from 'react-icons/fa';
import { pdfjs } from 'react-pdf';
import { 
  splitTextIntoChunks, 
  splitTextIntoPages, 
  mapChunksToPages,
  findChunkByPosition,
  getPositionInfo
} from './utils/documentUtils';
import './App.css';

// Initialize PDF.js worker
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

function App() {
  // Core document state
  const [documentText, setDocumentText] = useState('');
  const [totalPages, setTotalPages] = useState(1);
  
  // Enhanced page navigation state
  const [currentPage, setCurrentPage] = useState(1);
  const [docPages, setDocPages] = useState([]);
  const [currentPageText, setCurrentPageText] = useState('');
  
  // Speech chunks state
  const [textChunks, setTextChunks] = useState([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [chunkToPageMapping, setChunkToPageMapping] = useState({});
  
  // UI state
  const [bookmarks, setBookmarks] = useState([]);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(0);
  
  // Create refs to store context between renders
  const wordPositionsRef = useRef([]);
  const documentContentRef = useRef(null);
  const currentWordRef = useRef(null);
  const wordElementsRef = useRef({});
  const autoScrollingRef = useRef(false);
  const wordBoundaryUnsubscribeRef = useRef(null);
  
  const lastPositionRef = useRef({ 
    page: 1, 
    chunk: 0, 
    position: 0, 
    globalPosition: 0 
  });
  const readingProgressRef = useRef({
    lastPage: 1,
    lastPosition: 0
  });

  // Use our custom hooks for speech synthesis and document management
  const { 
    speaking, 
    paused,
    pause,
    resume,
    voices, 
    cancel, 
    setVoice,
    speakFromGlobalPosition,
    setPlaybackContext,
    getPlaybackContext,
    registerWordBoundaryListener
  } = useSpeechSynthesis();
  
  const {
    documents,
    activeDocument,
    loading: loadingDocuments,
    error: documentError,
    addNewDocument,
    removeDocumentFromLibrary,
    setActiveDocumentById
  } = useDocumentLibrary();

  // Handle document selection
  const handleSelectDocument = (documentId) => {
    // First, cancel any ongoing speech
    if (speaking) {
      cancel();
    }
    setIsPlaying(false);
    
    // Set the new active document
    const selectedDoc = setActiveDocumentById(documentId);
    
    if (selectedDoc) {
      // Update the document text
      setDocumentText(selectedDoc.text);
      
      // Generate text chunks for speech synthesis
      const chunks = splitTextIntoChunks(selectedDoc.text || '');
      setTextChunks(chunks);
      setCurrentChunkIndex(0);
      
      // Create book-like pages with consistent sizes
      // For PDFs, respect the actual page count, for other formats create pages with ~300 words each
      const pageCount = selectedDoc.pageCount || Math.max(1, Math.ceil(selectedDoc.text.length / 2000));
      const wordsPerPage = selectedDoc.type === 'pdf' ? 0 : 300; // 0 means use PDF's natural page breaks
      
      // Split text into true book-like pages
      const pages = splitTextIntoPages(selectedDoc.text || '', pageCount, wordsPerPage);
      setDocPages(pages);
      setTotalPages(pages.length);
      
      // Set initial page
      setCurrentPage(1);
      
      // Set initial page text
      if (pages.length > 0) {
        setCurrentPageText(pages[0].text);
      }
      
      // Create improved mapping between chunks and pages
      const mapping = mapChunksToPages(chunks, pages);
      setChunkToPageMapping(mapping);
      
      // Reset position tracking with enhanced global position
      lastPositionRef.current = { 
        page: 1, 
        chunk: 0, 
        position: 0,
        globalPosition: pages[0] ? pages[0].startPosition : 0
      };
      
      // Reset reading progress
      readingProgressRef.current = {
        lastPage: 1,
        lastPosition: 0
      };
      
      setError(null);
      
      // Try to restore last reading position from localStorage
      const lastPositionKey = `audioReadProPosition_${selectedDoc.id}`;
      const savedPosition = localStorage.getItem(lastPositionKey);
      
      if (savedPosition) {
        try {
          const positionData = JSON.parse(savedPosition);
          handlePageChange(positionData.page, false); // Don't start speaking automatically
        } catch (e) {
          console.error('Error restoring reading position:', e);
        }
      }
    }
  };
  
  // Handle adding new documents
  const handleAddDocument = async (acceptedFiles) => {
    try {
      if (!acceptedFiles || acceptedFiles.length === 0) return;
      
      const file = acceptedFiles[0];
      const newDoc = await addNewDocument(file);
      
      // Switch to the newly added document
      handleSelectDocument(newDoc.id);
    } catch (err) {
      setError(err.message);
    }
  };
  
  // Handle removing documents
  const handleRemoveDocument = (documentId) => {
    removeDocumentFromLibrary(documentId);
  };
    
  // Effect to update the selected voice when voices are loaded
  useEffect(() => {
    if (voices && voices.length > 0 && selectedVoiceIndex < voices.length) {
      setVoice(voices[selectedVoiceIndex]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, selectedVoiceIndex]);
  
  // Effect to update content when active document changes
  useEffect(() => {
    if (activeDocument) {
      // Update the document text
      setDocumentText(activeDocument.text);
      
      // Generate text chunks for speech synthesis
      const chunks = splitTextIntoChunks(activeDocument.text || '');
      setTextChunks(chunks);
      setCurrentChunkIndex(0);
      
      // Create book-like pages with consistent sizes
      // For PDFs, respect the actual page count, for other formats create pages with ~300 words each
      const pageCount = activeDocument.pageCount || Math.max(1, Math.ceil(activeDocument.text.length / 2000));
      const wordsPerPage = activeDocument.type === 'pdf' ? 0 : 300; // 0 means use PDF's natural page breaks
      
      // Split text into true book-like pages
      const pages = splitTextIntoPages(activeDocument.text || '', pageCount, wordsPerPage);
      setDocPages(pages);
      setTotalPages(pages.length);
      
      // Set initial page
      setCurrentPage(1);
      
      // Set initial page text
      if (pages.length > 0) {
        setCurrentPageText(pages[0].text);
      }
      
      // Create improved mapping between chunks and pages
      const mapping = mapChunksToPages(chunks, pages);
      setChunkToPageMapping(mapping);
      
      // Reset position tracking with enhanced global position
      lastPositionRef.current = { 
        page: 1, 
        chunk: 0, 
        position: 0,
        globalPosition: pages[0] ? pages[0].startPosition : 0
      };
      
      // Reset reading progress
      readingProgressRef.current = {
        lastPage: 1,
        lastPosition: 0
      };
    }
  }, [activeDocument]);

  // Handle play/pause using the global position API
  const handlePlayPause = () => {
    if (!activeDocument || !docPages.length) return;
    if (speaking) {
      if (paused) {
        // Resume from the current exact global character position
        resume();
        setIsPlaying(true);
      } else {
        // Save current position when pausing
        const context = getPlaybackContext();
        const currentPage = lastPositionRef.current.page;
        const pageStartPosition = docPages[currentPage - 1]?.startPosition || 0;

        lastPositionRef.current = {
          page: currentPage,
          chunk: currentChunkIndex,
          position: context.wordIndex,
          globalPosition: pageStartPosition + context.wordIndex
        };
        saveReadingPosition();
        pause();
        setIsPlaying(false);
      }
    } else if (textChunks.length > 0) {
      // Always resume precisely using the new API, with voice/rate
      speakFromGlobalPosition(
        typeof lastPositionRef.current.globalPosition === "number"
          ? lastPositionRef.current.globalPosition
          : 0,
        {
          text: documentText,
          chunks: textChunks,
          voice: voices[selectedVoiceIndex],
          rate: playbackRate
        }
      );

      setPlaybackContext({
        chunkIndex: currentChunkIndex,
        pageIndex: currentPage - 1,
        wordIndex: lastPositionRef.current.position
      });
      setIsPlaying(true);
    }
  };

  // Helper function to save the current reading position to localStorage
  const saveReadingPosition = () => {
    if (!activeDocument) return;
    
    const positionData = {
      page: lastPositionRef.current.page,
      chunk: lastPositionRef.current.chunk,
      position: lastPositionRef.current.position,
      globalPosition: lastPositionRef.current.globalPosition,
      timestamp: new Date().toISOString()
    };
    
    const positionKey = `audioReadProPosition_${activeDocument.id}`;
    localStorage.setItem(positionKey, JSON.stringify(positionData));
  };

  // Handle next chunk navigation using precise global char position API
  const handleNext = () => {
    if (!activeDocument || currentChunkIndex >= textChunks.length - 1) return;

    const nextChunkIndex = currentChunkIndex + 1;
    setCurrentChunkIndex(nextChunkIndex);

    // Find proper next page, update UI if needed
    if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[nextChunkIndex]) {
      const nextPage = chunkToPageMapping.chunkToPage[nextChunkIndex];
      if (nextPage !== currentPage) {
        handlePageChange(nextPage, false); // Don't auto-start speaking
      }
    }

    // Cancel existing playback
    if (speaking) cancel();

    // Use global character index for start of next chunk
    const chunkStart = chunkToPageMapping.chunkPositions?.[nextChunkIndex]?.start || 0;
    speakFromGlobalPosition(chunkStart, {
      text: documentText,
      chunks: textChunks,
      voice: voices[selectedVoiceIndex],
      rate: playbackRate
    });

    lastPositionRef.current = {
      page: currentPage,
      chunk: nextChunkIndex,
      position: 0,
      globalPosition: chunkStart
    };

    setPlaybackContext({
      chunkIndex: nextChunkIndex,
      pageIndex: currentPage - 1,
      wordIndex: 0
    });

    setIsPlaying(true);
    saveReadingPosition();
  };

  // Handle previous chunk navigation using global char position for seamless resume
  const handlePrevious = () => {
    if (!activeDocument || currentChunkIndex <= 0) return;

    const prevChunkIndex = currentChunkIndex - 1;
    setCurrentChunkIndex(prevChunkIndex);

    // Page navigation if chunk change moves to a different page
    if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[prevChunkIndex]) {
      const prevPage = chunkToPageMapping.chunkToPage[prevChunkIndex];
      if (prevPage !== currentPage) {
        handlePageChange(prevPage, false); // Don't auto-start speaking
      }
    }

    // Cancel any existing playback
    if (speaking) cancel();

    // Use global char index for start of previous chunk
    const chunkStart = chunkToPageMapping.chunkPositions?.[prevChunkIndex]?.start || 0;
    speakFromGlobalPosition(chunkStart, {
      text: documentText,
      chunks: textChunks,
      voice: voices[selectedVoiceIndex],
      rate: playbackRate
    });

    lastPositionRef.current = {
      page: currentPage,
      chunk: prevChunkIndex,
      position: 0,
      globalPosition: chunkStart
    };

    setPlaybackContext({
      chunkIndex: prevChunkIndex,
      pageIndex: currentPage - 1,
      wordIndex: 0
    });

    setIsPlaying(true);
    saveReadingPosition();
  };

  // Seek to any word in the document using global positioning for perfect highlighting and resume
  const handleWordClick = (word, wordIndex, totalOffset) => {
    if (!activeDocument) return;

    // Locate the correct chunk and relative position (for tracking UI only)
    const { chunkIndex, relativePosition } = findChunkByPosition(totalOffset, textChunks);

    setCurrentChunkIndex(chunkIndex);

    // Sync page UI if necessary
    const positionInfo = getPositionInfo(totalOffset, chunkToPageMapping, docPages);
    if (positionInfo.pageNumber !== currentPage) {
      handlePageChange(positionInfo.pageNumber, false); // Don't auto-start speaking
    }

    // Cancel any current speech
    if (speaking) cancel();

    // Play from the global char offset with all correct params
    speakFromGlobalPosition(totalOffset, {
      text: documentText,
      chunks: textChunks,
      voice: voices[selectedVoiceIndex],
      rate: playbackRate
    });

    lastPositionRef.current = {
      page: positionInfo.pageNumber,
      chunk: chunkIndex,
      position: relativePosition,
      globalPosition: totalOffset
    };

    setPlaybackContext({
      chunkIndex,
      pageIndex: positionInfo.pageNumber - 1,
      wordIndex: relativePosition
    });

    setIsPlaying(true);
    saveReadingPosition();
  };

  // Page navigation: synchronize audio from start of new page using global char index API
  const handlePageChange = (newPage, shouldSpeak = true) => {
    if (!activeDocument || !docPages.length || newPage < 1 || newPage > docPages.length) return;

    setCurrentPage(newPage);
    if (docPages[newPage - 1]) setCurrentPageText(docPages[newPage - 1].text);

    // Get page start position (global char index)
    const pageStartPosition = docPages[newPage - 1]?.startPosition || 0;

    // Find which chunk contains this global char position
    const { chunkIndex, relativePosition } = findChunkByPosition(pageStartPosition, textChunks);
    setCurrentChunkIndex(chunkIndex);

    lastPositionRef.current = {
      page: newPage,
      chunk: chunkIndex,
      position: relativePosition,
      globalPosition: pageStartPosition
    };

    if (shouldSpeak) {
      if (speaking) cancel();
      speakFromGlobalPosition(pageStartPosition, {
        text: documentText,
        chunks: textChunks,
        voice: voices[selectedVoiceIndex],
        rate: playbackRate
      });
      setIsPlaying(true);
    }

    setPlaybackContext({
      chunkIndex,
      pageIndex: newPage - 1,
      wordIndex: relativePosition
    });

    saveReadingPosition();
  };

  // Render text with clickable words - updated to use enhanced page information and IDs for tracking
  const renderTextWithClickableWords = () => {
    if (!currentPageText) return null;
    
    // Get the current page's starting position in the full document
    const pageStartPosition = docPages[currentPage - 1]?.startPosition || 0;
    
    // Reset word elements mapping for this page
    wordElementsRef.current = {};
    
    // Split text into paragraphs
    const paragraphs = currentPageText.split('\n');
    let totalOffset = pageStartPosition; // Start from the page's global offset
    
    return paragraphs.map((paragraph, paraIndex) => {
      if (!paragraph.trim()) return <p key={`p-${paraIndex}`}>&nbsp;</p>;
      
      // Get the current paragraph offset
      const paraOffset = totalOffset;
      totalOffset += paragraph.length + 1; // +1 for newline
      
      // Split paragraph into words
      const words = paragraph.split(/\b(\w+)\b/g);
      let wordOffset = paraOffset;
      
      return (
        <p key={`p-${paraIndex}`}>
          {words.map((word, wordIndex) => {
            const currentOffset = wordOffset;
            wordOffset += word.length;
            
            // Only make actual words clickable (not spaces, punctuation)
            if (/\w+/.test(word)) {
              // Create a normalized, lower-case word key/id for robust mapping.
              const rawKey = `word-${currentOffset - pageStartPosition}-${word}`;
              const wordKey = rawKey.replace(/\s+/g, '').toLowerCase();
              const wordId = wordKey;

              // Store the mapping between char position and word element ID
              const relativeCharIndex = currentOffset - pageStartPosition;
              wordElementsRef.current[wordKey] = wordId;

              return (
                <span 
                  id={wordId}
                  key={`word-${paraIndex}-${wordIndex}`}
                  className="clickable-word"
                  onClick={() => handleWordClick(word, wordIndex, currentOffset)}
                  style={{ cursor: 'pointer' }}
                  data-offset={currentOffset}
                  data-word={word}
                >
                  {word}
                </span>
              );
            } else {
              return <span key={`space-${paraIndex}-${wordIndex}`}>{word}</span>;
            }
          })}
        </p>
      );
    });
  };

  // Create and save a bookmark with enhanced position information
  const addBookmark = () => {
    if (!activeDocument) return;
    
    const newBookmark = {
      page: currentPage,
      chunk: currentChunkIndex,
      position: lastPositionRef.current.position,
      globalPosition: lastPositionRef.current.globalPosition,
      timestamp: new Date().toISOString(),
      documentId: activeDocument.id,
      text: currentPageText.substring(0, 50) + '...' // Save a snippet of text for context
    };
    
    setBookmarks(prev => [...prev, newBookmark]);
  };

  // Resume from bookmarks accurately using global char index and voice/speed
  const jumpToBookmark = (bookmark) => {
    // If switching documents, let document selection handle position
    if (activeDocument && bookmark.documentId && bookmark.documentId !== activeDocument.id) {
      setActiveDocumentById(bookmark.documentId);
      return;
    }

    // Go to correct page visually, but don't start playback yet
    handlePageChange(bookmark.page, false);
    setCurrentChunkIndex(bookmark.chunk);

    if (speaking) cancel();

    // Use globalPosition from bookmark for precise resume
    if (typeof bookmark.globalPosition === "number" && textChunks.length > bookmark.chunk) {
      speakFromGlobalPosition(bookmark.globalPosition, {
        text: documentText,
        chunks: textChunks,
        voice: voices[selectedVoiceIndex],
        rate: playbackRate
      });

      lastPositionRef.current = {
        page: bookmark.page,
        chunk: bookmark.chunk,
        position: bookmark.position || 0,
        globalPosition: bookmark.globalPosition || 0
      };

      setPlaybackContext({
        chunkIndex: bookmark.chunk,
        pageIndex: bookmark.page - 1,
        wordIndex: bookmark.position || 0
      });

      setIsPlaying(true);
    }
  };

  // Helper to get the most up-to-date globalPosition (from speech context or fallback)
  const getCurrentAudioGlobalPosition = () => {
    // Try to get currentPosition from useSpeechSynthesis playback context, fallback to lastPositionRef
    const synthContext = getPlaybackContext?.() || {};
    // Prefer playbackContext.currentPosition if it's a number and nonzero/valid
    if (typeof synthContext.currentPosition === "number" && synthContext.currentPosition >= 0) {
      return synthContext.currentPosition;
    }
    if (lastPositionRef.current && typeof lastPositionRef.current.globalPosition === "number") {
      return lastPositionRef.current.globalPosition;
    }
    return 0;
  };

  // Handle voice change: resumes playback at the same global position using new voice, with state sync
  const handleVoiceChange = (e) => {
    const voiceIndex = parseInt(e.target.value);
    setSelectedVoiceIndex(voiceIndex);

    if (voices && voices.length > 0) {
      setVoice(voices[voiceIndex]);
      // Before resuming, capture most precise spoken char position
      const globalPos = getCurrentAudioGlobalPosition();
      if (activeDocument && documentText && isPlaying && typeof globalPos === "number") {
        cancel();
        speakFromGlobalPosition(globalPos, {
          text: documentText,
          chunks: textChunks,
          voice: voices[voiceIndex],
          rate: playbackRate
        });
        // Important: update lastPositionRef too for bookmarks and other resume
        lastPositionRef.current.globalPosition = globalPos;
        setIsPlaying(true);
      }
    }
  };

  // Handle playback rate change: resumes playback at the same global position using new rate, with state sync
  const handlePlaybackRateChange = (e) => {
    const newRate = parseFloat(e.target.value);
    setPlaybackRate(newRate);
    // Always use the most current position to avoid resuming from beginning of chunk
    const globalPos = getCurrentAudioGlobalPosition();
    if (activeDocument && documentText && isPlaying && typeof globalPos === "number") {
      cancel();
      speakFromGlobalPosition(globalPos, {
        text: documentText,
        chunks: textChunks,
        voice: voices[selectedVoiceIndex],
        rate: newRate
      });
      lastPositionRef.current.globalPosition = globalPos;
      setIsPlaying(true);
    }
  };
  
  // Handle word boundary events for auto-scrolling and highlighting
  // Enhanced: Always use updated wordData.charIndex (global offset) to find and apply highlight
  const handleWordBoundary = useCallback((wordData) => {
    if (!wordData || typeof wordData.charIndex !== "number" || !wordData.word) return;

    // Find which page contains this charIndex
    let pageIdx = docPages.findIndex(page =>
      wordData.charIndex >= page.startPosition && wordData.charIndex < page.endPosition
    );
    if (pageIdx === -1) {
      // fallback to previous/current page as best effort
      pageIdx = Math.max(0, Math.min(currentPage - 1, docPages.length - 1));
    }

    // If page has changed (due to seeking), update current page to sync highlight
    if ((pageIdx + 1) !== currentPage) {
      setCurrentPage(pageIdx + 1);
      setCurrentPageText(docPages[pageIdx]?.text || '');
    }

    const pageStartPosition = docPages[pageIdx]?.startPosition || 0;
    const relativeCharIndex = wordData.charIndex - pageStartPosition;

    // __ Robust lookup, normalized/whitespace-safe keys __
    let wordKey = `word-${relativeCharIndex}-${wordData.word}`;
    wordKey = wordKey.replace(/\s+/g, '').toLowerCase();

    // Attempt direct key->id match
    let wordElementId = wordElementsRef.current[wordKey];
    let wordElement = wordElementId ? document.getElementById(wordElementId) : null;

    // Fallback: try nearby id/key match for the same word
    if (!wordElement) {
      const possibleKeys = Object.entries(wordElementsRef.current);
      let bestDistance = Number.MAX_SAFE_INTEGER, candidateId = null;
      for (const [key, id] of possibleKeys) {
        const match = key.match(/^word-(\-?\d+)-(.+)$/);
        if (match) {
          const charIdx = parseInt(match[1]);
          const w = match[2];
          if (
            w.replace(/\s+/g, '').toLowerCase() === wordData.word.replace(/\s+/g, '').toLowerCase() &&
            Math.abs(charIdx - relativeCharIndex) < 7
          ) {
            const dist = Math.abs(charIdx - relativeCharIndex);
            if (dist < bestDistance) {
              bestDistance = dist;
              candidateId = id;
            }
          }
        }
      }
      if (candidateId) {
        wordElementId = candidateId;
        wordElement = document.getElementById(wordElementId);
      }
    }

    // As a last resort, search for a span in the page content with matching text and closest offset.
    if (!wordElement) {
      const docContent = documentContentRef.current;
      if (docContent) {
        const spans = docContent.querySelectorAll('span.clickable-word');
        let bestMatch = null;
        let bestDist = Number.MAX_SAFE_INTEGER;
        spans.forEach(el => {
          const elWord = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
          if (elWord === wordData.word.replace(/\s+/g, '').toLowerCase()) {
            const offset = Number(el.getAttribute('data-offset'));
            const dist = Math.abs(offset - wordData.charIndex);
            if (dist < bestDist) {
              bestDist = dist;
              bestMatch = el;
            }
          }
        });
        if (bestMatch) {
          wordElement = bestMatch;
          wordElementId = bestMatch.id || null;
        }
      }
    }

    // Clean up previous highlight
    if (currentWordRef.current) {
      const prevWordElement = document.getElementById(currentWordRef.current);
      if (prevWordElement) {
        prevWordElement.classList.remove('word-current');
        prevWordElement.classList.add('word-spoken');
      }
    }

    if (wordElement) {
      currentWordRef.current = wordElementId;
      wordElement.classList.add('word-current');
      // Remove spoken highlight from previous word after a delay for visible effect
      setTimeout(() => {
        if (wordElement) wordElement.classList.remove('word-spoken');
      }, 100);

      if (autoScrollingRef.current && documentContentRef.current) {
        wordElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPages, currentPage]);

  // Save bookmarks with current active document
  useEffect(() => {
    if (!activeDocument) return;
    
    // Store bookmarks with the document ID
    const bookmarkKey = `audioReadProBookmarks_${activeDocument.id}`;
    localStorage.setItem(bookmarkKey, JSON.stringify(bookmarks));
  }, [bookmarks, activeDocument]);

  // Load bookmarks for current active document
  useEffect(() => {
    if (!activeDocument) {
      setBookmarks([]);
      return;
    }
    
    const bookmarkKey = `audioReadProBookmarks_${activeDocument.id}`;
    const savedBookmarks = localStorage.getItem(bookmarkKey);
    if (savedBookmarks) {
      try {
        setBookmarks(JSON.parse(savedBookmarks));
      } catch (e) {
        console.error('Error loading bookmarks:', e);
        setBookmarks([]);
      }
    } else {
      setBookmarks([]);
    }
  }, [activeDocument]);

  // Set up the word boundary listener when speaking status changes or playback config changes
  useEffect(() => {
    if (speaking && !paused) {
      autoScrollingRef.current = true;
      // Always (re-)register word boundary listener for newest context
      if (wordBoundaryUnsubscribeRef.current) {
        wordBoundaryUnsubscribeRef.current();
      }
      wordBoundaryUnsubscribeRef.current = registerWordBoundaryListener(handleWordBoundary);
    } else {
      autoScrollingRef.current = false;
    }
    // Clean up on unmount or deps change
    return () => {
      if (wordBoundaryUnsubscribeRef.current) {
        wordBoundaryUnsubscribeRef.current();
        wordBoundaryUnsubscribeRef.current = null;
      }
    };
  }, [speaking, paused, registerWordBoundaryListener, handleWordBoundary, docPages, currentPage]);
  
  // Clean up highlighting when changing pages (resync highlight after resumes/seeks)
  useEffect(() => {
    // Always clear highlight states
    wordElementsRef.current = {};
    currentWordRef.current = null;

    // Remove any lingering highlights
    const highlightedElements = document.querySelectorAll('.word-current, .word-spoken');
    highlightedElements.forEach(el => {
      el.classList.remove('word-current', 'word-spoken');
    });
  }, [currentPage, docPages]);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (speaking) {
        cancel();
      }
      
      // Clean up word boundary listener
      if (wordBoundaryUnsubscribeRef.current) {
        wordBoundaryUnsubscribeRef.current();
        wordBoundaryUnsubscribeRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  if (!window.speechSynthesis) {
    return <div className="error-message">Text-to-speech is not supported in your browser.</div>;
  }

  return (
    <div className="app">
      <div className="container">
        <div className="document-view">
          {activeDocument ? (
            <>
              <div 
                ref={documentContentRef} 
                className={`document-content ${speaking ? 'auto-scrolling' : ''}`}
              >
                {renderTextWithClickableWords()}
              </div>
              <div className="page-navigation">
                <button 
                  className="btn" 
                  onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  Previous Page
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button 
                  className="btn" 
                  onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next Page
                </button>
              </div>
            </>
          ) : (
            <div className="document-placeholder">
              <p>Select a document from your library or add a new one to get started</p>
            </div>
          )}
        </div>

        <div className="controls-panel">
          {/* Document Library Component */}
          <DocumentLibrary
            documents={documents}
            activeDocument={activeDocument}
            onAddDocument={handleAddDocument}
            onRemoveDocument={handleRemoveDocument}
            onSelectDocument={handleSelectDocument}
            loading={loadingDocuments}
          />
          
          {loadingDocuments && (
            <div className="loading-indicator">
              <p>Loading documents...</p>
            </div>
          )}

          {bookmarks.length > 0 && (
            <div className="bookmark-list">
              <h3>Bookmarks</h3>
              {bookmarks.map((bookmark, index) => (
                <div 
                  key={index} 
                  className="bookmark-item"
                  onClick={() => jumpToBookmark(bookmark)}
                >
                  <span>Page {bookmark.page}</span>
                  <span>{new Date(bookmark.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}

          {(error || documentError) && (
            <div className="error-message">
              {error || documentError}
            </div>
          )}
        </div>
      </div>
      
      {/* Fixed Audio Controls Bar */}
      <div className="audio-controls-bar">
        <div className="playback-main-controls">
          <button 
            className="btn" 
            onClick={handlePrevious} 
            disabled={!activeDocument || currentChunkIndex === 0}
          >
            <FaBackward />
          </button>
          
          <button 
            className={`btn ${isPlaying ? 'btn-secondary' : ''}`} 
            onClick={handlePlayPause} 
            disabled={!activeDocument}
          >
            {speaking && !paused ? <FaPause /> : <FaPlay />}
          </button>
          
          <button 
            className="btn" 
            onClick={handleNext} 
            disabled={!activeDocument || currentChunkIndex === textChunks.length - 1}
          >
            <FaForward />
          </button>
          
          <button 
            className="btn btn-secondary" 
            onClick={addBookmark} 
            disabled={!activeDocument}
          >
            <FaBookmark />
          </button>
        </div>
        
        <div className="page-info">
          {activeDocument && <span>Page {currentPage} of {totalPages}</span>}
        </div>
        
        <div className="playback-settings">
          <div className="voice-control">
            <select 
              className="select-control"
              onChange={handleVoiceChange}
              value={selectedVoiceIndex}
              disabled={!activeDocument}
            >
              {voices && voices.length > 0 ? (
                voices.map((voice, index) => (
                  <option key={index} value={index}>
                    {voice.name} ({voice.lang})
                  </option>
                ))
              ) : (
                <option value="">Loading voices...</option>
              )}
            </select>
          </div>
          
          <div className="speed-control-container">
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={playbackRate}
              onChange={handlePlaybackRateChange}
              className="speed-control"
              disabled={!activeDocument}
            />
            <div>{playbackRate}x</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
