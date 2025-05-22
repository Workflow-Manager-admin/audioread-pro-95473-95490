import React, { useState, useCallback, useEffect } from 'react';
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

  const { speak, speaking, voices, cancel } = useSpeechSynthesis();

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

  const handlePlayPause = () => {
    if (speaking) {
      cancel();
      setIsPlaying(false);
    } else if (textChunks.length > 0) {
      const utterance = new SpeechSynthesisUtterance(textChunks[currentChunkIndex]);
      utterance.rate = playbackRate;
      
      // Safely set voice if voices array is available
      if (voices && voices.length > 0) {
        utterance.voice = voices.find(v => v.default) || voices[0];
      }
      
      utterance.onend = () => {
        if (currentChunkIndex < textChunks.length - 1) {
          setCurrentChunkIndex(prev => prev + 1);
          const nextUtterance = new SpeechSynthesisUtterance(textChunks[currentChunkIndex + 1]);
          nextUtterance.rate = playbackRate;
          
          // Safely set voice if voices array is available
          if (voices && voices.length > 0) {
            nextUtterance.voice = voices.find(v => v.default) || voices[0];
          }
          
          speak(nextUtterance);
        } else {
          setIsPlaying(false);
        }
      };
      speak(utterance);
      setIsPlaying(true);
    }
  };

  const handleNext = () => {
    if (currentChunkIndex < textChunks.length - 1) {
      setCurrentChunkIndex(prev => prev + 1);
      if (speaking) {
        cancel();
        const utterance = new SpeechSynthesisUtterance(textChunks[currentChunkIndex + 1]);
        utterance.rate = playbackRate;
        
        // Safely set voice if voices array is available
        if (voices && voices.length > 0) {
          utterance.voice = voices.find(v => v.default) || voices[0];
        }
        
        speak(utterance);
      }
    }
  };

  const handlePrevious = () => {
    if (currentChunkIndex > 0) {
      setCurrentChunkIndex(prev => prev - 1);
      if (speaking) {
        cancel();
        const utterance = new SpeechSynthesisUtterance(textChunks[currentChunkIndex - 1]);
        utterance.rate = playbackRate;
        
        // Safely set voice if voices array is available
        if (voices && voices.length > 0) {
          utterance.voice = voices.find(v => v.default) || voices[0];
        }
        
        speak(utterance);
      }
    }
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
      const utterance = new SpeechSynthesisUtterance(textChunks[bookmark.chunk]);
      utterance.rate = playbackRate;
      utterance.voice = voices.find(v => v.default) || null;
      speak(utterance);
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
                {documentText.split('\n').map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
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
                {speaking ? <FaPause /> : <FaPlay />}
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
                onChange={(e) => {
                  const utterance = new SpeechSynthesisUtterance('');
                  utterance.voice = voices[e.target.value];
                  speak(utterance);
                }}
              >
                {voices.map((voice, index) => (
                  <option key={index} value={index}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>

              <h3>Playback Speed</h3>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
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
