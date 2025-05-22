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
    speak, 
    speaking, 
    paused,
    pause,
    resume,
    voices, 
    cancel, 
    setVoice,
    speakFromPosition,
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

  // Handle play/pause button with enhanced position tracking
  const handlePlayPause = () => {
    if (!activeDocument || !docPages.length) return;
    
    if (speaking) {
      if (paused) {
        // Resume from the current position
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
        
        // Save reading position to localStorage
        saveReadingPosition();
        
        pause();
        setIsPlaying(false);
      }
    } else if (textChunks.length > 0) {
      // If we have a saved position, try to resume from there
      if (lastPositionRef.current.position > 0 && currentChunkIndex === lastPositionRef.current.chunk) {
        speakFromPosition(lastPositionRef.current.position, { rate: playbackRate });
      } else {
        // Otherwise start from the beginning of the current chunk
        speak(textChunks[currentChunkIndex], { rate: playbackRate });
      }
      
      // Update playback context
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

  // Handle next chunk with enhanced page synchronization
  const handleNext = () => {
    if (!activeDocument || currentChunkIndex >= textChunks.length - 1) return;
    
    const nextChunkIndex = currentChunkIndex + 1;
    setCurrentChunkIndex(nextChunkIndex);
    
    // Use improved mapping to find the correct page for this chunk
    if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[nextChunkIndex]) {
      const nextPage = chunkToPageMapping.chunkToPage[nextChunkIndex];
      
      // Update page if needed
      if (nextPage !== currentPage) {
        handlePageChange(nextPage, false); // Don't auto-start speaking
      }
    }
    
    // Handle playback
    if (speaking) {
      cancel();
    }
    
    speak(textChunks[nextChunkIndex], { rate: playbackRate });
    
    // Update position tracking with global position
    const chunkStart = chunkToPageMapping.chunkPositions?.[nextChunkIndex]?.start || 0;
    lastPositionRef.current = {
      page: currentPage,
      chunk: nextChunkIndex,
      position: 0,
      globalPosition: chunkStart
    };
    
    // Update playback context
    setPlaybackContext({
      chunkIndex: nextChunkIndex,
      pageIndex: currentPage - 1,
      wordIndex: 0
    });
    
    setIsPlaying(true);
    
    // Save updated reading position
    saveReadingPosition();
  };

  // Handle previous chunk with enhanced page synchronization
  const handlePrevious = () => {
    if (!activeDocument || currentChunkIndex <= 0) return;
    
    const prevChunkIndex = currentChunkIndex - 1;
    setCurrentChunkIndex(prevChunkIndex);
    
    // Use improved mapping to find the correct page for this chunk
    if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[prevChunkIndex]) {
      const prevPage = chunkToPageMapping.chunkToPage[prevChunkIndex];
      
      // Update page if needed
      if (prevPage !== currentPage) {
        handlePageChange(prevPage, false); // Don't auto-start speaking
      }
    }
    
    // Handle playback
    if (speaking) {
      cancel();
    }
    
    speak(textChunks[prevChunkIndex], { rate: playbackRate });
    
    // Update position tracking with global position
    const chunkStart = chunkToPageMapping.chunkPositions?.[prevChunkIndex]?.start || 0;
    lastPositionRef.current = {
      page: currentPage,
      chunk: prevChunkIndex,
      position: 0,
      globalPosition: chunkStart
    };
    
    // Update playback context
    setPlaybackContext({
      chunkIndex: prevChunkIndex,
      pageIndex: currentPage - 1,
      wordIndex: 0
    });
    
    setIsPlaying(true);
    
    // Save updated reading position
    saveReadingPosition();
  };

  // Handle word click with enhanced position tracking and page synchronization
  const handleWordClick = (word, wordIndex, totalOffset) => {
    if (!activeDocument) return;
    
    // Use the global character position to find the correct chunk
    const { chunkIndex, relativePosition } = findChunkByPosition(totalOffset, textChunks);
    
    // Update current chunk index
    setCurrentChunkIndex(chunkIndex);
    
    // Find the correct page for this position and update if needed
    const positionInfo = getPositionInfo(totalOffset, chunkToPageMapping, docPages);
    if (positionInfo.pageNumber !== currentPage) {
      handlePageChange(positionInfo.pageNumber, false); // Don't auto-start speaking
    }
    
    // Speak from this position
    if (speaking) {
      cancel();
    }
    
    speakFromPosition(relativePosition, { rate: playbackRate });
    
    // Update position tracking with global position
    lastPositionRef.current = {
      page: positionInfo.pageNumber,
      chunk: chunkIndex,
      position: relativePosition,
      globalPosition: totalOffset
    };
    
    // Update playback context
    setPlaybackContext({
      chunkIndex,
      pageIndex: positionInfo.pageNumber - 1,
      wordIndex: relativePosition
    });
    
    setIsPlaying(true);
    
    // Save updated reading position
    saveReadingPosition();
  };

  // Handle page navigation with enhanced audio synchronization
  const handlePageChange = (newPage, shouldSpeak = true) => {
    if (!activeDocument || !docPages.length || newPage < 1 || newPage > docPages.length) return;
    
    // Update page state
    setCurrentPage(newPage);
    
    // Update current page text
    if (docPages[newPage - 1]) {
      setCurrentPageText(docPages[newPage - 1].text);
    }
    
    // Get the start position of this page
    const pageStartPosition = docPages[newPage - 1]?.startPosition || 0;
    
    // Find the chunk that contains the start of this page
    const { chunkIndex, relativePosition } = findChunkByPosition(pageStartPosition, textChunks);
    
    // Update current chunk index
    setCurrentChunkIndex(chunkIndex);
    
    // Update position tracking with global position
    lastPositionRef.current = {
      page: newPage,
      chunk: chunkIndex,
      position: relativePosition,
      globalPosition: pageStartPosition
    };
    
    // If requested, start speaking from this position
    if (shouldSpeak) {
      if (speaking) {
        cancel();
      }
      
      speak(textChunks[chunkIndex], { rate: playbackRate });
      setIsPlaying(true);
    }
    
    // Update playback context
    setPlaybackContext({
      chunkIndex,
      pageIndex: newPage - 1,
      wordIndex: relativePosition
    });
    
    // Save updated reading position
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
              // Create a unique ID for this word
              const wordId = `word-${currentOffset - pageStartPosition}-${word}`;
              
              // Store the mapping between char position and word element ID
              const relativeCharIndex = currentOffset - pageStartPosition;
              wordElementsRef.current[`word-${relativeCharIndex}-${word}`] = wordId;
              
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

  // Jump to a bookmark with enhanced position handling
  const jumpToBookmark = (bookmark) => {
    // Ensure we're using the correct document
    if (activeDocument && bookmark.documentId && bookmark.documentId !== activeDocument.id) {
      setActiveDocumentById(bookmark.documentId);
      // The rest will be handled when the active document changes
      return;
    }
    
    // Navigate to the bookmark's page
    handlePageChange(bookmark.page, false); // Don't auto-start speech
    
    // Set chunk index
    setCurrentChunkIndex(bookmark.chunk);
    
    if (speaking) {
      cancel();
    }
    
    // Start speaking from the saved position
    if (textChunks.length > bookmark.chunk) {
      if (bookmark.position) {
        speakFromPosition(bookmark.position, { rate: playbackRate });
      } else {
        speak(textChunks[bookmark.chunk], { rate: playbackRate });
      }
      
      // Update position tracking
      lastPositionRef.current = {
        page: bookmark.page,
        chunk: bookmark.chunk,
        position: bookmark.position || 0,
        globalPosition: bookmark.globalPosition || 0
      };
      
      // Update playback context
      setPlaybackContext({
        chunkIndex: bookmark.chunk,
        pageIndex: bookmark.page - 1,
        wordIndex: bookmark.position || 0
      });
      
      setIsPlaying(true);
    }
  };

  // Handle voice change
  const handleVoiceChange = (e) => {
    const voiceIndex = parseInt(e.target.value);
    setSelectedVoiceIndex(voiceIndex);
    
    if (voices && voices.length > 0) {
      setVoice(voices[voiceIndex]);
    }
  };

  // Handle playback rate change
  const handlePlaybackRateChange = (e) => {
    const newRate = parseFloat(e.target.value);
    setPlaybackRate(newRate);
    
    // If currently speaking, update the rate
    if (speaking && !paused) {
      cancel();
      speak(textChunks[currentChunkIndex], { rate: newRate });
    }
  };
  
  // Handle word boundary events for auto-scrolling and highlighting
  const handleWordBoundary = useCallback((wordData) => {
    if (!wordData || !wordData.word) return;
    
    const { word, charIndex } = wordData;
    
    // Get the page offset for the current page
    const pageStartPosition = docPages[currentPage - 1]?.startPosition || 0;
    const relativeCharIndex = charIndex - pageStartPosition;
    
    // Find the word element based on the char index or word content
    const wordKey = `word-${relativeCharIndex}-${word}`;
    const alternateKey = Object.keys(wordElementsRef.current).find(key => 
      key.includes(`-${word}`) && Math.abs(parseInt(key.split('-')[1]) - relativeCharIndex) < 50
    );
    
    const wordElementId = wordElementsRef.current[wordKey] || 
                        (alternateKey && wordElementsRef.current[alternateKey]) ||
                        `word-${relativeCharIndex}`;
    
    const wordElement = document.getElementById(wordElementId);
    
    // Update current word ref and remove highlight from previous word
    if (currentWordRef.current) {
      const prevWordElement = document.getElementById(currentWordRef.current);
      if (prevWordElement) {
        prevWordElement.classList.remove('word-current');
        prevWordElement.classList.add('word-spoken');
      }
    }
    
    // Set and highlight the new current word
    if (wordElement) {
      currentWordRef.current = wordElementId;
      wordElement.classList.add('word-current');
      
      // Scroll the word into view if auto-scrolling is enabled
      if (autoScrollingRef.current && documentContentRef.current) {
        const docView = documentContentRef.current;
        
        // Scroll with smooth behavior to center the word in view
        wordElement.scrollIntoView({
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  }, [currentPage, docPages]);

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

  // Set up the word boundary listener when speaking status changes
  useEffect(() => {
    // Only register listener when speaking and not paused
    if (speaking && !paused) {
      // Enable auto-scrolling
      autoScrollingRef.current = true;
      
      // Register the word boundary listener
      if (!wordBoundaryUnsubscribeRef.current) {
        wordBoundaryUnsubscribeRef.current = registerWordBoundaryListener(handleWordBoundary);
      }
    } else {
      // If not speaking or paused, we can disable auto-scrolling
      autoScrollingRef.current = false;
    }
    
    // Clean up on unmount or when speaking state changes
    return () => {
      if (wordBoundaryUnsubscribeRef.current) {
        wordBoundaryUnsubscribeRef.current();
        wordBoundaryUnsubscribeRef.current = null;
      }
    };
  }, [speaking, paused, registerWordBoundaryListener, handleWordBoundary]);
  
  // Clean up highlighting when changing pages
  useEffect(() => {
    // Reset the word elements mapping when page changes
    wordElementsRef.current = {};
    currentWordRef.current = null;
    
    // Return cleanup function
    return () => {
      const highlightedElements = document.querySelectorAll('.word-current, .word-spoken');
      highlightedElements.forEach(el => {
        el.classList.remove('word-current', 'word-spoken');
      });
    };
  }, [currentPage]);

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
