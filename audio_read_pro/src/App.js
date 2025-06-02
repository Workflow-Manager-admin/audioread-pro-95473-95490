import React, { useState, useEffect, useRef, useCallback } from 'react';
import useSpeechSynthesis from './hooks/useSpeechSynthesis';
import useDocumentLibrary from './hooks/useDocumentLibrary';

/**
 * IMPLEMENTATION PLAN:
 * 1. Always reset highlight state and playback context when navigating to a new page.
 * 2. On next/prev page navigation, playback must start at the true first word (first global char position) of that page.
 * 3. On page change (manual or by chunk jump), reset all highlight state before rendering.
 * 4. Use robust mapping from global position to page and span for highlighting (exclusive end for page, fixes off-by-one).
 * 5. Ensure all 'speakFromGlobalPosition' invocations for new page start use the precise page.startPosition.
 * 6. Defensive: On all navigation (manual and code-driven), call clearAllHighlights().
 * 7. Ensure handlers and UI always treat page boundary as an atomic navigation reset for playback/highlight.
 */
import DocumentLibrary from './components/DocumentLibrary';
import { FaPlay, FaPause, FaForward, FaBackward, FaBookmark } from 'react-icons/fa';
import { pdfjs } from 'react-pdf';
import { 
  splitTextIntoChunks, 
  splitTextIntoPages, 
  mapChunksToPages,
  findChunkByPosition,
  getPositionInfo,
  splitTextToWordSpans
} from './utils/documentUtils';
import './App.css';

/**
 * PDF.js worker initialization for react-pdf.
 * Use a statically served worker from the public/ directory to avoid CORS and dynamic import issues.
 * See: https://github.com/wojtekmaj/react-pdf#setting-up-pdf-worker
 */
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

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
    registerWordBoundaryListener,
    getCurrentGlobalPosition,
    clearAllSpeechContext,
    isFatalSyncError
  } = useSpeechSynthesis();

  // Defensive global: UI feedback if browser/tts sync error
  const [speechFatalSync, setSpeechFatalSync] = useState(false);

  // Defensive: Clear all highlights and all speech context (synchronize both UI and speech even if API is broken)
  const fullyResetSpeechAndHighlights = useCallback(() => {
    clearAllHighlights();
    clearAllSpeechContext();
    setIsPlaying(false);
  }, []);
  
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
    setSpeechFatalSync(false); // clear sync errors on document change
    setError(null);

    // Set the new active document
    const selectedDoc = setActiveDocumentById(documentId);
    
    if (selectedDoc) {
      // Update the document text
      setDocumentText(selectedDoc.text);
      // (rest unchanged) ...
  
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

    clearAllHighlights();
    clearAllSpeechContext();
    setSpeechFatalSync(false); // on user retry, clear banner

    if (speaking) {
      if (paused) {
        resume();
        setIsPlaying(true);
        setSpeechFatalSync(false);
      } else {
        const context = getPlaybackContext();
        const currentPageNum = lastPositionRef.current.page;
        const pageStartPosition = docPages[currentPageNum - 1]?.startPosition || 0;
        lastPositionRef.current = {
          page: currentPageNum,
          chunk: currentChunkIndex,
          position: context.wordIndex,
          globalPosition: pageStartPosition + context.wordIndex
        };
        saveReadingPosition();
        pause();
        setIsPlaying(false);
      }
    } else if (textChunks.length > 0) {
      const preciseGlobal =
        typeof lastPositionRef.current.globalPosition === "number"
          ? lastPositionRef.current.globalPosition
          : 0;
      speakFromGlobalPosition(preciseGlobal, {
        text: documentText,
        chunks: textChunks,
        voice: voices[selectedVoiceIndex],
        rate: playbackRate
      });

      setPlaybackContext({
        chunkIndex: currentChunkIndex,
        pageIndex: currentPage - 1,
        wordIndex: lastPositionRef.current.position
      });
      setIsPlaying(true);
      setSpeechFatalSync(false);
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

    // Force context reset/cancel before any logic
    clearAllHighlights();
    clearAllSpeechContext();

    const nextChunkIndex = currentChunkIndex + 1;

    let nextPage = currentPage;
    if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[nextChunkIndex]) {
      nextPage = chunkToPageMapping.chunkToPage[nextChunkIndex];
      if (nextPage !== currentPage) {
        handlePageChange(nextPage, true); // Auto-start speaking at true start
        return; // handlePageChange performs all state/audio resets
      }
    }

    setCurrentChunkIndex(nextChunkIndex);

    const chunkStart = chunkToPageMapping.chunkPositions?.[nextChunkIndex]?.start || 0;
    // Always use canonical, never skip the first word
    speakFromGlobalPosition(chunkStart, {
      text: documentText,
      chunks: textChunks,
      voice: voices[selectedVoiceIndex],
      rate: playbackRate
    });

    lastPositionRef.current = {
      page: nextPage,
      chunk: nextChunkIndex,
      position: 0,
      globalPosition: chunkStart
    };

    setPlaybackContext({
      chunkIndex: nextChunkIndex,
      pageIndex: nextPage - 1,
      wordIndex: 0
    });

    setIsPlaying(true);
    saveReadingPosition();
  };

  // Handle previous chunk navigation using global char position for seamless resume
  const handlePrevious = () => {
    if (!activeDocument || currentChunkIndex <= 0) return;

    // Force context reset/cancel before any logic
    clearAllHighlights();
    clearAllSpeechContext();

    const prevChunkIndex = currentChunkIndex - 1;

    let prevPage = currentPage;
    if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[prevChunkIndex]) {
      prevPage = chunkToPageMapping.chunkToPage[prevChunkIndex];
      if (prevPage !== currentPage) {
        handlePageChange(prevPage, true);
        return;
      }
    }

    setCurrentChunkIndex(prevChunkIndex);

    const chunkStart = chunkToPageMapping.chunkPositions?.[prevChunkIndex]?.start || 0;
    speakFromGlobalPosition(chunkStart, {
      text: documentText,
      chunks: textChunks,
      voice: voices[selectedVoiceIndex],
      rate: playbackRate
    });

    lastPositionRef.current = {
      page: prevPage,
      chunk: prevChunkIndex,
      position: 0,
      globalPosition: chunkStart
    };

    setPlaybackContext({
      chunkIndex: prevChunkIndex,
      pageIndex: prevPage - 1,
      wordIndex: 0
    });

    setIsPlaying(true);
    saveReadingPosition();
  };

  // Seek to any word in the document using global positioning for perfect highlighting and resume
  const handleWordClick = (word, wordIndex, totalOffset) => {
    if (!activeDocument) return;

    // Force context reset/cancel before any logic
    clearAllHighlights();
    clearAllSpeechContext();

    // Locate the correct chunk and relative position (for tracking UI only)
    const { chunkIndex, relativePosition } = findChunkByPosition(totalOffset, textChunks);

    setCurrentChunkIndex(chunkIndex);

    // Sync page UI if necessary
    const positionInfo = getPositionInfo(totalOffset, chunkToPageMapping, docPages);
    if (positionInfo.pageNumber !== currentPage) {
      handlePageChange(positionInfo.pageNumber, false); // Don't auto-start speaking
    }

    // Always use canonical
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

  // Page navigation: synchronize audio/highlight state from new page
  // PUBLIC_INTERFACE
  const handlePageChange = (newPage, shouldSpeak = true) => {
    if (!activeDocument || !docPages.length || newPage < 1 || newPage > docPages.length) return;

    // --- Defensive: clear highlight state and audio context on every page navigation ---
    clearAllHighlights();
    wordElementsRef.current = {};
    currentWordRef.current = null;

    cancel();
    setIsPlaying(false);

    setCurrentPage(newPage);
    if (docPages[newPage - 1]) setCurrentPageText(docPages[newPage - 1].text);

    // Get true start for this page (global character index)
    const pageStartPosition = docPages[newPage - 1]?.startPosition || 0;

    // Find which chunk and relative word this position is, for TTS-context sync
    const { chunkIndex, relativePosition } = findChunkByPosition(pageStartPosition, textChunks);
    setCurrentChunkIndex(chunkIndex);

    // Reset playback state/ref exactly to the start of this page
    lastPositionRef.current = {
      page: newPage,
      chunk: chunkIndex,
      position: relativePosition,
      globalPosition: pageStartPosition
    };

    setPlaybackContext({
      chunkIndex,
      pageIndex: newPage - 1,
      wordIndex: relativePosition
    });

    if (shouldSpeak) {
      // Always clear before speaking new page
      clearAllHighlights();
      cancel();
      // Use canonical: do not skip first word
      speakFromGlobalPosition(pageStartPosition, {
        text: documentText,
        chunks: textChunks,
        voice: voices[selectedVoiceIndex],
        rate: playbackRate
      });
      setIsPlaying(true);
    }

    saveReadingPosition();
  };

  // --- Robust clear all highlights: ---
  function clearAllHighlights() {
    document.querySelectorAll('.word-current, .word-spoken').forEach(el => {
      el.classList.remove('word-current', 'word-spoken');
    });
  }

  // --- Memoized shared word spans for current full document scope (cross-page) ---
  // This ensures both rendering and boundary logic use the same splitTextToWordSpans output.
  const [sharedWordSpans, setSharedWordSpans] = useState([]);
  useEffect(() => {
    if (documentText) {
      try {
        // Only recompute if document text changes
        setSharedWordSpans(splitTextToWordSpans(documentText, 0));
      } catch (e) {
        setSharedWordSpans([]);
      }
    } else {
      setSharedWordSpans([]);
    }
  }, [documentText]);

  // Render text with clickable words, emitting spans aligned to canonical offsets
  const renderTextWithClickableWords = () => {
    if (!currentPageText) return null;
    clearAllHighlights();

    // Correct starting offset for this page within the global text
    const pageStart = docPages[currentPage - 1]?.startPosition || 0;
    const pageEnd = docPages[currentPage - 1]?.endPosition || 0;
    wordElementsRef.current = {};

    // Defensive: filter sharedWordSpans to only those whose offset is in current page range
    const pageWordSpans = (sharedWordSpans || []).filter(
      span =>
        typeof span.offset === 'number' &&
        span.offset >= pageStart &&
        span.offset < pageEnd
    );

    // Generate markup: reconstruct paragraphs by slice of word spans between paragraph breaks
    // Paragraphs by \n, track running globalOffset
    const paragraphs = currentPageText.split('\n');
    let paraSpans = [];
    let currOffset = pageStart;
    let wordSpanIdx = 0;

    return paragraphs.map((paragraph, paraIndex) => {
      let paraLen = paragraph.length + 1; // +1 for newline
      // Gather all word spans whose offset falls in this paragraph range (defensive for CR/LF)
      let paraStart = currOffset;
      let paraEnd = paraStart + paragraph.length;
      let theseSpans = [];
      // Defensive lookahead
      while (
        wordSpanIdx < pageWordSpans.length &&
        pageWordSpans[wordSpanIdx].offset < paraEnd
      ) {
        theseSpans.push(pageWordSpans[wordSpanIdx]);
        wordSpanIdx++;
      }
      currOffset += paraLen;

      if (!paragraph.trim()) {
        return <p key={`p-${paraIndex}`}>&nbsp;</p>;
      }
      return (
        <p key={`p-${paraIndex}`}>
          {theseSpans.length
            ? theseSpans.map((span, idx) => {
                // Canonical wordKey, always based on global offsets (for current page).
                const relOffset = span.offset - pageStart;
                const wordKey = `word-${relOffset}-${span.text}`.replace(/\s+/g, '').toLowerCase();
                const wordId = wordKey;

                if (span.word) {
                  wordElementsRef.current[wordKey] = wordId;
                  return (
                    <span
                      id={wordId}
                      key={wordKey}
                      className="clickable-word"
                      onClick={() => handleWordClick(span.text, idx, span.offset)}
                      data-offset={span.offset}
                      data-word={span.text}
                      style={{ cursor: 'pointer' }}
                    >
                      {span.text}
                    </span>
                  );
                } else {
                  // Spaces or punctuation
                  return <span key={`space-${paraIndex}-${idx}`}>{span.text}</span>;
                }
              })
            : paragraph}
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
    // Isolate context before jumping anywhere
    clearAllHighlights();
    clearAllSpeechContext();

    // If switching documents, let document selection handle position
    if (activeDocument && bookmark.documentId && bookmark.documentId !== activeDocument.id) {
      setActiveDocumentById(bookmark.documentId);
      return;
    }

    // Go to correct page visually, but don't start playback yet
    handlePageChange(bookmark.page, false);
    setCurrentChunkIndex(bookmark.chunk);

    // Use globalPosition from bookmark for precise resume
    if (typeof bookmark.globalPosition === "number" && textChunks.length > bookmark.chunk) {
      // Canonical: always start on the exact same char offset as the bookmark (never skip word/page start)
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

  // Helper to get the most up-to-date globalPosition (from hook's API if available)
  const getCurrentAudioGlobalPosition = () => {
    if (typeof getCurrentGlobalPosition === "function") {
      const pos = getCurrentGlobalPosition();
      if (typeof pos === "number" && pos >= 0) return pos;
    }
    // Try to get from playback context object (legacy fallback)
    const synthContext = getPlaybackContext?.() || {};
    if (typeof synthContext.currentPosition === "number" && synthContext.currentPosition >= 0) {
      return synthContext.currentPosition;
    }
    // Else fallback to last position ref we manually tracked
    if (lastPositionRef.current && typeof lastPositionRef.current.globalPosition === "number") {
      return lastPositionRef.current.globalPosition;
    }
    return 0;
  };

  // Handle voice change: If audio is playing, resume from last spoken word.
  // If NOT playing, notify user to press play.
  const [showPlaybackReminder, setShowPlaybackReminder] = useState(false);
  const handleVoiceChange = (e) => {
    const voiceIndex = parseInt(e.target.value);
    setSelectedVoiceIndex(voiceIndex);

    if (voices && voices.length > 0) {
      setVoice(voices[voiceIndex]);
      const globalPos = getCurrentAudioGlobalPosition();

      if (activeDocument && documentText && isPlaying && typeof globalPos === "number") {
        cancel();
        speakFromGlobalPosition(globalPos, {
          text: documentText,
          chunks: textChunks,
          voice: voices[voiceIndex],
          rate: playbackRate
        });
        lastPositionRef.current.globalPosition = globalPos;
        setIsPlaying(true);
        setShowPlaybackReminder(false);
      } else {
        // If not playing, show UI reminder to play
        setShowPlaybackReminder(true);
      }
    }
  };

  // Handle playback rate change: If audio is playing, resumes at precisely last word.
  const handlePlaybackRateChange = (e) => {
    const newRate = parseFloat(e.target.value);
    setPlaybackRate(newRate);
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
      setShowPlaybackReminder(false);
    } else if (!(activeDocument && documentText && isPlaying)) {
      // If not playing now, show UI reminder to play
      setShowPlaybackReminder(true);
    }
  };
  
  // Handle word boundary events for auto-scrolling & precise highlighting (robust and unambiguous)
  const handleWordBoundary = useCallback((wordData) => {
    // Defensive: robust browser sync errors/timeouts/catastrophic faults
    if (wordData && (wordData.type === "fatal-sync" || wordData.type === "stuck")) {
      fullyResetSpeechAndHighlights();
      setSpeechFatalSync(true);
      setError(
        wordData.type === "fatal-sync"
          ? "Browser Speech API malfunctioned or disappeared. Please refresh your browser to restore audio."
          : wordData.reason || "Speech playback lost sync. Audio cancelled."
      );
      return;
    }

    if (!wordData || typeof wordData.charIndex !== "number" || !wordData.word) return;

    // --- All mapping centralized: always use splitTextToWordSpans for TTS charIndex-to-word-span mapping ---
    // Find the doc page index covering this charIndex
    let pageIdx = docPages.findIndex(page =>
      wordData.charIndex >= page.startPosition && wordData.charIndex < page.endPosition
    );
    if (pageIdx === -1) {
      // Clamp fallback for ambiguous position
      pageIdx = Math.max(0, Math.min(currentPage - 1, docPages.length - 1));
    }

    // Synchronize UI page if needed
    if ((pageIdx + 1) !== currentPage) {
      setCurrentPage(pageIdx + 1);
      setCurrentPageText(docPages[pageIdx]?.text || '');
    }

    const pageStartPosition = docPages[pageIdx]?.startPosition || 0;
    const pageEndPosition = docPages[pageIdx]?.endPosition || 0;

    // Find target span using canonical mapping (robust, never out-of-page)
    let canonicalSpan = null;
    if (Array.isArray(sharedWordSpans) && sharedWordSpans.length > 0) {
      for (let i = 0; i < sharedWordSpans.length; i++) {
        const span = sharedWordSpans[i];
        if (
          typeof span.offset === 'number' &&
          span.word &&
          span.offset <= wordData.charIndex &&
          wordData.charIndex < span.offset + span.text.length &&
          span.offset >= pageStartPosition &&
          span.offset < pageEndPosition
        ) {
          canonicalSpan = span;
          break;
        }
      }
      // Fallback: nearest prior span in current page
      if (!canonicalSpan) {
        let best = null;
        let closestDist = Infinity;
        for (let i = 0; i < sharedWordSpans.length; i++) {
          const s = sharedWordSpans[i];
          if (
            s &&
            s.word &&
            typeof s.offset === 'number' &&
            s.offset >= pageStartPosition &&
            s.offset < pageEndPosition &&
            s.offset <= wordData.charIndex &&
            wordData.charIndex - s.offset < closestDist &&
            wordData.charIndex - s.offset < 50
          ) {
            closestDist = wordData.charIndex - s.offset;
            best = s;
          }
        }
        canonicalSpan = best;
      }
    }

    let wordKey = null;
    if (canonicalSpan && canonicalSpan.offset >= pageStartPosition && canonicalSpan.offset < pageEndPosition) {
      const relOffset = canonicalSpan.offset - pageStartPosition;
      wordKey = `word-${relOffset}-${canonicalSpan.text}`.replace(/\s+/g, '').toLowerCase();
    }

    // Clear highlights before applying new
    clearAllHighlights();

    let wordElement = null;
    // Canonical: by render key
    if (wordKey && wordElementsRef.current[wordKey]) {
      wordElement = document.getElementById(wordElementsRef.current[wordKey]);
    }

    // Fallback: by DOM/offset/text search if mapping unclear
    if (!wordElement && documentContentRef.current) {
      const spans = documentContentRef.current.querySelectorAll('span.clickable-word');
      let bestMatch = null, bestDist = 10000;
      spans.forEach(el => {
        if ((el.textContent || '').trim().toLowerCase() === (wordData.word || '').trim().toLowerCase()) {
          const offset = Number(el.getAttribute('data-offset'));
          // Only select those within this page's range
          if (offset >= pageStartPosition && offset < pageEndPosition) {
            const dist = Math.abs(offset - wordData.charIndex);
            if (dist < bestDist) {
              bestDist = dist;
              bestMatch = el;
            }
          }
        }
      });
      if (bestMatch) wordElement = bestMatch;
    }

    // Never apply highlight if mapping is ambiguous or outside current view
    if (!wordElement) {
      currentWordRef.current = null;
      return;
    }

    // Highlight/unhighlight
    if (currentWordRef.current && currentWordRef.current !== wordElement.id) {
      const prevWord = document.getElementById(currentWordRef.current);
      if (prevWord) prevWord.classList.remove('word-current', 'word-spoken');
    }

    if (wordElement) {
      currentWordRef.current = wordElement.id;
      wordElement.classList.add('word-current');
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
  }, [docPages, currentPage, sharedWordSpans]);

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
  useEffect(() => {
    // Defensive: catch browser sync loss from hook anytime (including after timeout)
    if (typeof isFatalSyncError === 'function' && isFatalSyncError()) {
      setSpeechFatalSync(true);
      setError("Browser Speech API synchronization failed. Try reloading this page if audio controls remain unresponsive.");
      fullyResetSpeechAndHighlights();
    }
    // Do not clear fatalSync on successful speech, only clear on user event (handled elsewhere)
    // eslint-disable-next-line
  }, [isFatalSyncError]);
  
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
      fullyResetSpeechAndHighlights();
      setSpeechFatalSync(false);
      setError(null);
      if (wordBoundaryUnsubscribeRef.current) {
        wordBoundaryUnsubscribeRef.current();
        wordBoundaryUnsubscribeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                  onClick={() => {
                    clearAllHighlights();
                    handlePageChange(Math.max(1, currentPage - 1));
                  }}
                  disabled={currentPage === 1}
                >
                  Previous Page
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button 
                  className="btn" 
                  onClick={() => {
                    clearAllHighlights();
                    handlePageChange(Math.min(totalPages, currentPage + 1));
                  }}
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
      {showPlaybackReminder && activeDocument && (
        <div
          className="playback-reminder-banner"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'var(--controls-bar-height)',
            zIndex: 1200,
            background: '#ffeeba',
            color: '#856404',
            padding: '12px 20px',
            borderTop: '1px solid #ffe8a1',
            borderBottom: '1px solid #ffe8a1',
            textAlign: 'center',
            fontSize: '1.06rem',
            fontWeight: 500,
            boxShadow: '0 -1px 6px rgba(0,0,0,0.04)'
          }}
          aria-live="polite"
        >
          <span>
            Playback is paused. After changing <b>voice</b> or <b>speed</b>, press <span style={{fontWeight:600}}>Play</span> to start or resume audio from your last position.
          </span>
        </div>
      )}
    </div>
  );
}

export default App;
