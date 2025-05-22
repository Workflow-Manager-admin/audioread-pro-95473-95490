import React, { useState, useEffect, useRef } from 'react';
import useSpeechSynthesis from './hooks/useSpeechSynthesis';
import useDocumentLibrary from './hooks/useDocumentLibrary';
import DocumentLibrary from './components/DocumentLibrary';
import { FaPlay, FaPause, FaForward, FaBackward, FaBookmark } from 'react-icons/fa';
import { pdfjs } from 'react-pdf';
import { splitTextIntoChunks, splitTextIntoPages, mapChunksToPages } from './utils/documentUtils';
import './App.css';

// Initialize PDF.js worker
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

function App() {
  const [documentText, setDocumentText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [displayPage, setDisplayPage] = useState(1);
  const [textChunks, setTextChunks] = useState([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [bookmarks, setBookmarks] = useState([]);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(0);
  
  // Enhanced page navigation state
  const [docPages, setDocPages] = useState([]);
  const [currentPageText, setCurrentPageText] = useState('');
  const [chunkToPageMapping, setChunkToPageMapping] = useState({});
  
  // Create refs to store context between renders
  const wordPositionsRef = useRef([]);
  const lastPositionRef = useRef({ page: 1, chunk: 0, position: 0 });

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
    getPlaybackContext
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
      // Update the document text and related state variables
      setDocumentText(selectedDoc.text);
      const pageCount = selectedDoc.pageCount || 1;
      setTotalPages(pageCount);
      setCurrentPage(1);
      setDisplayPage(1);
      
      // Generate text chunks for speech
      const chunks = splitTextIntoChunks(selectedDoc.text || '');
      setTextChunks(chunks);
      setCurrentChunkIndex(0);
      
      // Split text into pages for navigation
      const pages = splitTextIntoPages(selectedDoc.text || '', pageCount);
      setDocPages(pages);
      
      // Set initial page text
      if (pages.length > 0) {
        setCurrentPageText(pages[0].text);
      }
      
      // Create mapping between chunks and pages
      const mapping = mapChunksToPages(chunks, pages);
      setChunkToPageMapping(mapping);
      
      // Reset position tracking
      lastPositionRef.current = { page: 1, chunk: 0, position: 0 };
      
      setError(null);
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
      setDocumentText(activeDocument.text);
      const pageCount = activeDocument.pageCount || 1;
      setTotalPages(pageCount);
      setCurrentPage(1);
      setDisplayPage(1);
      
      // Generate text chunks for speech
      const chunks = splitTextIntoChunks(activeDocument.text || '');
      setTextChunks(chunks);
      setCurrentChunkIndex(0);
      
      // Split text into pages for navigation
      const pages = splitTextIntoPages(activeDocument.text || '', pageCount);
      setDocPages(pages);
      
      // Set initial page text
      if (pages.length > 0) {
        setCurrentPageText(pages[0].text);
      }
      
      // Create mapping between chunks and pages
      const mapping = mapChunksToPages(chunks, pages);
      setChunkToPageMapping(mapping);
      
      // Reset position tracking
      lastPositionRef.current = { page: 1, chunk: 0, position: 0 };
    }
  }, [activeDocument]);

  // Handle play/pause button with enhanced position tracking
  const handlePlayPause = () => {
    if (speaking) {
      if (paused) {
        // Resume from the current position
        resume();
        setIsPlaying(true);
      } else {
        // Save current position when pausing
        const context = getPlaybackContext();
        lastPositionRef.current = {
          page: displayPage,
          chunk: currentChunkIndex,
          position: context.wordIndex
        };
        pause();
        setIsPlaying(false);
      }
    } else if (textChunks.length > 0) {
      // If we have a saved position, try to resume from there
      if (lastPositionRef.current.position > 0 && currentChunkIndex === lastPositionRef.current.chunk) {
        speakFromPosition(lastPositionRef.current.position, { rate: playbackRate });
        
        // Update playback context
        setPlaybackContext({
          chunkIndex: currentChunkIndex,
          pageIndex: displayPage - 1
        });
      } else {
        // Otherwise start from the beginning of the current chunk
        speak(textChunks[currentChunkIndex], { rate: playbackRate });
        
        // Update playback context
        setPlaybackContext({
          chunkIndex: currentChunkIndex,
          pageIndex: displayPage - 1
        });
      }
      setIsPlaying(true);
    }
  };

  // Handle next chunk with enhanced playback continuity
  const handleNext = () => {
    if (currentChunkIndex < textChunks.length - 1) {
      const nextChunkIndex = currentChunkIndex + 1;
      setCurrentChunkIndex(nextChunkIndex);
      
      // Update page if the chunk belongs to a different page
      if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[nextChunkIndex]) {
        const nextPage = chunkToPageMapping.chunkToPage[nextChunkIndex];
        if (nextPage !== displayPage) {
          setDisplayPage(nextPage);
          setCurrentPage(nextPage);
          
          // Update current page text
          if (docPages[nextPage - 1]) {
            setCurrentPageText(docPages[nextPage - 1].text);
          }
        }
      }
      
      // Handle playback
      if (speaking) {
        cancel();
      }
      speak(textChunks[nextChunkIndex], { rate: playbackRate });
      
      // Update playback context
      setPlaybackContext({
        chunkIndex: nextChunkIndex,
        pageIndex: displayPage - 1
      });
      
      // Reset position tracking
      lastPositionRef.current = {
        page: displayPage,
        chunk: nextChunkIndex,
        position: 0
      };
      
      setIsPlaying(true);
    }
  };

  // Handle previous chunk with enhanced playback continuity
  const handlePrevious = () => {
    if (currentChunkIndex > 0) {
      const prevChunkIndex = currentChunkIndex - 1;
      setCurrentChunkIndex(prevChunkIndex);
      
      // Update page if the chunk belongs to a different page
      if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[prevChunkIndex]) {
        const prevPage = chunkToPageMapping.chunkToPage[prevChunkIndex];
        if (prevPage !== displayPage) {
          setDisplayPage(prevPage);
          setCurrentPage(prevPage);
          
          // Update current page text
          if (docPages[prevPage - 1]) {
            setCurrentPageText(docPages[prevPage - 1].text);
          }
        }
      }
      
      // Handle playback
      if (speaking) {
        cancel();
      }
      speak(textChunks[prevChunkIndex], { rate: playbackRate });
      
      // Update playback context
      setPlaybackContext({
        chunkIndex: prevChunkIndex,
        pageIndex: displayPage - 1
      });
      
      // Reset position tracking
      lastPositionRef.current = {
        page: displayPage,
        chunk: prevChunkIndex,
        position: 0
      };
      
      setIsPlaying(true);
    }
  };

  // Handle word click to start speaking from that position with enhanced state management
  const handleWordClick = (word, wordIndex, totalOffset) => {
    // Find the character position of this word in the full text
    const charPosition = totalOffset;
    
    // Find which chunk this position belongs to
    let chunkIndex = 0;
    let chunkStart = 0;
    
    for (let i = 0; i < textChunks.length; i++) {
      const chunkEnd = chunkStart + textChunks[i].length;
      if (charPosition >= chunkStart && charPosition < chunkEnd) {
        chunkIndex = i;
        break;
      }
      chunkStart = chunkEnd;
    }
    
    // Update current chunk index
    setCurrentChunkIndex(chunkIndex);
    
    // Get the relative position within the chunk
    const relativePosition = charPosition - chunkStart;
    
    // Update page if needed
    if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[chunkIndex]) {
      const pageForChunk = chunkToPageMapping.chunkToPage[chunkIndex];
      if (pageForChunk !== displayPage) {
        setDisplayPage(pageForChunk);
        setCurrentPage(pageForChunk);
        
        // Update current page text
        if (docPages[pageForChunk - 1]) {
          setCurrentPageText(docPages[pageForChunk - 1].text);
        }
      }
    }
    
    // Speak from this position
    if (speaking) {
      cancel();
    }
    
    // Update playback context
    setPlaybackContext({
      chunkIndex,
      pageIndex: displayPage - 1,
      wordIndex: relativePosition
    });
    
    // Update position tracking
    lastPositionRef.current = {
      page: displayPage,
      chunk: chunkIndex,
      position: relativePosition
    };
    
    speakFromPosition(relativePosition, { rate: playbackRate });
    setIsPlaying(true);
  };

  // Handle page navigation
  const handlePageChange = (newPage) => {
    // Update page state
    setDisplayPage(newPage);
    setCurrentPage(newPage);
    
    // Update current page text
    if (docPages[newPage - 1]) {
      setCurrentPageText(docPages[newPage - 1].text);
    }
    
    // Find the first chunk that belongs to this page
    if (chunkToPageMapping.pageToChunks && chunkToPageMapping.pageToChunks[newPage]) {
      const firstChunkOnPage = chunkToPageMapping.pageToChunks[newPage][0];
      
      // If the found chunk is valid, update current chunk index
      if (firstChunkOnPage !== undefined && textChunks[firstChunkOnPage]) {
        setCurrentChunkIndex(firstChunkOnPage);
        
        // If currently speaking, update to speak from the new chunk
        if (speaking && !paused) {
          cancel();
          speak(textChunks[firstChunkOnPage], { rate: playbackRate });
          setIsPlaying(true);
        }
        
        // Update playback context
        setPlaybackContext({
          chunkIndex: firstChunkOnPage,
          pageIndex: newPage - 1
        });
        
        // Update position tracking
        lastPositionRef.current = {
          page: newPage,
          chunk: firstChunkOnPage,
          position: 0
        };
      }
    }
  };

  // Render text with clickable words - updated to show only current page content
  const renderTextWithClickableWords = (text) => {
    if (!text) return null;
    
    // Use current page text instead of full document text
    const textToRender = currentPageText || text;
    
    // Calculate offset based on current page position in full document
    let pageStartOffset = 0;
    
    // Find the starting offset of the current page in the full document text
    if (displayPage > 1 && docPages.length >= displayPage) {
      for (let i = 0; i < displayPage - 1; i++) {
        if (docPages[i]) {
          pageStartOffset += docPages[i].text.length + 2; // +2 for page separator
        }
      }
    }
    
    // Split text into paragraphs
    const paragraphs = textToRender.split('\n');
    let totalOffset = pageStartOffset; // Start from the page offset
    
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
              return (
                <span 
                  key={`word-${paraIndex}-${wordIndex}`}
                  className="clickable-word"
                  onClick={() => handleWordClick(word, wordIndex, currentOffset)}
                  style={{ cursor: 'pointer' }}
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

  const addBookmark = () => {
    if (!activeDocument) return;
    
    const newBookmark = {
      page: currentPage,
      chunk: currentChunkIndex,
      timestamp: new Date().toISOString(),
      documentId: activeDocument.id
    };
    setBookmarks(prev => [...prev, newBookmark]);
  };

  const jumpToBookmark = (bookmark) => {
    // Ensure we're using the correct document
    if (activeDocument && bookmark.documentId && bookmark.documentId !== activeDocument.id) {
      setActiveDocumentById(bookmark.documentId);
    }
    
    setCurrentPage(bookmark.page);
    setCurrentChunkIndex(bookmark.chunk);
    
    if (speaking) {
      cancel();
    }
    
    // Only try to speak if we have chunks available
    if (textChunks.length > bookmark.chunk) {
      speak(textChunks[bookmark.chunk], { rate: playbackRate });
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

  // Synchronize page navigation with text chunks
  useEffect(() => {
    if (textChunks.length > 0 && !chunkToPageMapping.chunkToPage) {
      // If we don't have a proper mapping, fall back to the original behavior
      const estimatedChunksPerPage = Math.ceil(textChunks.length / totalPages);
      const currentEstimatedPage = Math.ceil((currentChunkIndex + 1) / estimatedChunksPerPage);
      if (currentEstimatedPage !== displayPage) {
        setDisplayPage(currentEstimatedPage);
        
        // Update current page text
        if (docPages[currentEstimatedPage - 1]) {
          setCurrentPageText(docPages[currentEstimatedPage - 1].text);
        }
      }
    } else if (chunkToPageMapping.chunkToPage && chunkToPageMapping.chunkToPage[currentChunkIndex]) {
      // Use our mapping to determine the correct page
      const mappedPage = chunkToPageMapping.chunkToPage[currentChunkIndex];
      if (mappedPage !== displayPage) {
        setDisplayPage(mappedPage);
        
        // Update current page text
        if (docPages[mappedPage - 1]) {
          setCurrentPageText(docPages[mappedPage - 1].text);
        }
      }
    }
  }, [currentChunkIndex, displayPage, textChunks.length, totalPages, chunkToPageMapping, docPages]);

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
      setBookmarks(JSON.parse(savedBookmarks));
    } else {
      setBookmarks([]);
    }
  }, [activeDocument]);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (speaking) {
        cancel();
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
              <div className="document-content">
                {renderTextWithClickableWords(currentPageText || documentText)}
              </div>
              <div className="page-navigation">
                <button 
                  className="btn" 
                  onClick={() => handlePageChange(Math.max(1, displayPage - 1))}
                  disabled={displayPage === 1}
                >
                  Previous Page
                </button>
                <span>Page {displayPage} of {totalPages}</span>
                <button 
                  className="btn" 
                  onClick={() => handlePageChange(Math.min(totalPages, displayPage + 1))}
                  disabled={displayPage === totalPages}
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
          
          {/* Playback controls moved to fixed audio controls bar */}

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
          {activeDocument && <span>Page {displayPage} of {totalPages}</span>}
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
