import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import useSpeechSynthesis from './hooks/useSpeechSynthesis';
import { FaPlay, FaPause, FaForward, FaBackward, FaBookmark } from 'react-icons/fa';
import { pdfjs } from 'react-pdf';
import { processDocument, splitTextIntoChunks } from './utils/documentUtils';
import './App.css';

// Initialize PDF.js worker
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

function App() {
  const [document, setDocument] = useState(null);
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
  
  // Create a ref to store word positions in the document
  const wordPositionsRef = useRef([]);

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

  const onDrop = useCallback(async (acceptedFiles) => {
    try {
      const file = acceptedFiles[0];
      setDocument(file);
      
      const { text, pageCount } = await processDocument(file);
      setDocumentText(text);
      setTotalPages(pageCount);
      setCurrentPage(1);
      
      const chunks = splitTextIntoChunks(text);
      setTextChunks(chunks);
      setCurrentChunkIndex(0);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt']
    },
    multiple: false
  });

  // Effect to update the selected voice when voices are loaded
  useEffect(() => {
    if (voices && voices.length > 0 && selectedVoiceIndex < voices.length) {
      setVoice(voices[selectedVoiceIndex]);
    }
  }, [voices, selectedVoiceIndex]);  // Remove setVoice from dependencies

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

  // Function to parse text into clickable words
  const renderTextWithClickableWords = (text) => {
    if (!text) return null;
    
    // Split text into paragraphs
    return text.split('\n').map((paragraph, paraIndex) => {
      if (!paragraph.trim()) return <p key={`p-${paraIndex}`}>&nbsp;</p>;
      
      // Calculate the total offset for this paragraph
      let totalOffset = 0;
      for (let i = 0; i < paraIndex; i++) {
        totalOffset += text.split('\n')[i].length + 1; // +1 for the newline
      }
      
      // Split paragraph into words
      const words = paragraph.split(/(\s+)/);
      
      return (
        <p key={`p-${paraIndex}`}>
          {words.map((word, wordIndex) => {
            const currentOffset = totalOffset;
            totalOffset += word.length;
            
            // Store word position for future reference
            wordPositionsRef.current.push({
              word,
              offset: currentOffset
            });
            
            return word.trim() ? (
              <span 
                key={`word-${paraIndex}-${wordIndex}`}
                className="clickable-word"
                onClick={() => handleWordClick(word, wordIndex, currentOffset)}
                style={{ cursor: 'pointer', padding: '0 1px' }}
              >
                {word}
              </span>
            ) : (
              <span key={`space-${paraIndex}-${wordIndex}`}>{word}</span>
            );
          })}
        </p>
      );
    });
  };

  const addBookmark = () => {
    const newBookmark = {
      page: currentPage,
      chunk: currentChunkIndex,
      timestamp: new Date().toISOString()
    };
    setBookmarks(prev => [...prev, newBookmark]);
  };

  const jumpToBookmark = (bookmark) => {
    setCurrentPage(bookmark.page);
    setCurrentChunkIndex(bookmark.chunk);
    if (speaking) {
      cancel();
    }
    speak(textChunks[bookmark.chunk], { rate: playbackRate });
    setIsPlaying(true);
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

  useEffect(() => {
    // Save bookmarks to localStorage
    localStorage.setItem('audioReadProBookmarks', JSON.stringify(bookmarks));
  }, [bookmarks]);

  // Synchronize page navigation with text chunks
  useEffect(() => {
    if (textChunks.length > 0) {
      const estimatedChunksPerPage = Math.ceil(textChunks.length / totalPages);
      const currentEstimatedPage = Math.ceil((currentChunkIndex + 1) / estimatedChunksPerPage);
      setDisplayPage(currentEstimatedPage);
    }
  }, [currentChunkIndex, textChunks.length, totalPages]);

  useEffect(() => {
    // Load bookmarks from localStorage
    const savedBookmarks = localStorage.getItem('audioReadProBookmarks');
    if (savedBookmarks) {
      setBookmarks(JSON.parse(savedBookmarks));
    }
  }, []);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (speaking) {
        cancel();
      }
    };
  }, [speaking, cancel]);

  if (!window.speechSynthesis) {
    return <div className="error-message">Text-to-speech is not supported in your browser.</div>;
  }

  return (
    <div className="app">
      <div className="container">
        <div className="document-view">
          {document ? (
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
              <div {...getRootProps()} className="upload-zone">
                <input {...getInputProps()} />
                <p>Drag & drop a PDF, DOCX, or TXT file here, or click to select one</p>
              </div>
            </div>
          )}
        </div>

        <div className="controls-panel">
          <div className="controls-section">
            <h3>Playback Controls</h3>
            <div className="playback-controls">
              <button className="btn" onClick={handlePrevious} disabled={!document || currentChunkIndex === 0}>
                <FaBackward />
              </button>
              <button 
                className={`btn ${isPlaying ? 'btn-secondary' : ''}`} 
                onClick={handlePlayPause} 
                disabled={!document}
              >
                {speaking && !paused ? <FaPause /> : <FaPlay />}
              </button>
              <button className="btn" onClick={handleNext} disabled={!document || currentChunkIndex === textChunks.length - 1}>
                <FaForward />
              </button>
              <button className="btn btn-secondary" onClick={addBookmark} disabled={!document}>
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

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
