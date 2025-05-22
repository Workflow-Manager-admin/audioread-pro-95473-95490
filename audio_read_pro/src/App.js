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
    speakFromPosition 
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
      setTotalPages(selectedDoc.pageCount || 1);
      setCurrentPage(1);
      setDisplayPage(1);
      
      // Generate text chunks
      const chunks = splitTextIntoChunks(selectedDoc.text || '');
      setTextChunks(chunks);
      setCurrentChunkIndex(0);
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
      setTotalPages(activeDocument.pageCount || 1);
      setCurrentPage(1);
      setDisplayPage(1);
      
      // Generate text chunks
      const chunks = splitTextIntoChunks(activeDocument.text || '');
      setTextChunks(chunks);
      setCurrentChunkIndex(0);
    }
  }, [activeDocument]);

  // Handle play/pause button
  const handlePlayPause = () => {
    if (speaking) {
      if (paused) {
        resume();
      } else {
        pause();
      }
    } else if (textChunks.length > 0) {
      speak(textChunks[currentChunkIndex], { rate: playbackRate });
      setIsPlaying(true);
    }
    setIsPlaying(!paused);
  };

  // Handle next chunk
  const handleNext = () => {
    if (currentChunkIndex < textChunks.length - 1) {
      setCurrentChunkIndex(prev => prev + 1);
      if (speaking) {
        cancel();
      }
      speak(textChunks[currentChunkIndex + 1], { rate: playbackRate });
      setIsPlaying(true);
    }
  };

  // Handle previous chunk
  const handlePrevious = () => {
    if (currentChunkIndex > 0) {
      setCurrentChunkIndex(prev => prev - 1);
      if (speaking) {
        cancel();
      }
      speak(textChunks[currentChunkIndex - 1], { rate: playbackRate });
      setIsPlaying(true);
    }
  };

  // Handle word click to start speaking from that position
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
    
    // Speak from this position
    if (speaking) {
      cancel();
    }
    
    speakFromPosition(relativePosition, { rate: playbackRate });
    setIsPlaying(true);
  };

  // Simplified function to render text with clickable words
  const renderTextWithClickableWords = (text) => {
    if (!text) return null;
    
    // Split text into paragraphs
    const paragraphs = text.split('\n');
    let totalOffset = 0;
    
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

  // Save bookmarks with current active document
  useEffect(() => {
    if (!activeDocument) return;
    
    // Store bookmarks with the document ID
    const bookmarkKey = `audioReadProBookmarks_${activeDocument.id}`;
    localStorage.setItem(bookmarkKey, JSON.stringify(bookmarks));
  }, [bookmarks, activeDocument]);

  // Synchronize page navigation with text chunks
  useEffect(() => {
    if (textChunks.length > 0) {
      const estimatedChunksPerPage = Math.ceil(textChunks.length / totalPages);
      const currentEstimatedPage = Math.ceil((currentChunkIndex + 1) / estimatedChunksPerPage);
      setDisplayPage(currentEstimatedPage);
    }
  }, [currentChunkIndex, textChunks.length, totalPages]);

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
                {renderTextWithClickableWords(documentText)}
              </div>
              <div className="page-navigation">
                <button 
                  className="btn" 
                  onClick={() => setDisplayPage(prev => Math.max(1, prev - 1))}
                  disabled={displayPage === 1}
                >
                  Previous Page
                </button>
                <span>Page {displayPage} of {totalPages}</span>
                <button 
                  className="btn" 
                  onClick={() => setDisplayPage(prev => Math.min(totalPages, prev + 1))}
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
          
          <div className="controls-section">
            <h3>Playback Controls</h3>
            <div className="playback-controls">
              <button className="btn" onClick={handlePrevious} disabled={!activeDocument || currentChunkIndex === 0}>
                <FaBackward />
              </button>
              <button 
                className={`btn ${isPlaying ? 'btn-secondary' : ''}`} 
                onClick={handlePlayPause} 
                disabled={!activeDocument}
              >
                {speaking && !paused ? <FaPause /> : <FaPlay />}
              </button>
              <button className="btn" onClick={handleNext} disabled={!activeDocument || currentChunkIndex === textChunks.length - 1}>
                <FaForward />
              </button>
              <button className="btn btn-secondary" onClick={addBookmark} disabled={!activeDocument}>
                <FaBookmark />
              </button>
            </div>

            <div className="controls-section">
              <h3>Voice Settings</h3>
              <select 
                className="select-control"
                onChange={handleVoiceChange}
                value={selectedVoiceIndex}
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

              <h3>Playback Speed</h3>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={playbackRate}
                onChange={handlePlaybackRateChange}
                className="speed-control"
              />
              <div>{playbackRate}x</div>
            </div>
          </div>

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
    </div>
  );
}

export default App;
