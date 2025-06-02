import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for using the Web Speech API for speech synthesis
 * Enhanced with pause/resume, voice switching capabilities, and improved word position tracking
 * Now with support for word boundary listeners to enable auto-scrolling and highlighting
 */
const useSpeechSynthesis = () => {
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  
  // Enhanced tracking for utterance, text position, and context
  const utteranceRef = useRef(null);
  const currentTextRef = useRef('');
  const currentPositionRef = useRef(0);
  const lastWordRef = useRef('');
  const selectedVoiceRef = useRef(null);
  const wordBoundaryListenersRef = useRef([]);
  const currentWordDataRef = useRef({
    word: '',
    charIndex: 0,
    startTime: 0
  });
  const playbackContextRef = useRef({
    chunkIndex: 0,
    pageIndex: 0,
    wordIndex: 0
  });
  
  // Get available voices and update when the list changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    // Function to get and set voices
    const getVoices = () => {
      const voiceOptions = window.speechSynthesis.getVoices();
      setVoices(voiceOptions);
      
      // Set default voice if available
      if (voiceOptions.length > 0 && !selectedVoiceRef.current) {
        selectedVoiceRef.current = voiceOptions.find(voice => voice.default) || voiceOptions[0];
      }
    };
    
    // Get initial list of voices
    getVoices();
    
    // Chrome and some browsers load voices asynchronously
    window.speechSynthesis.onvoiceschanged = getVoices;
    
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);
  
  // Clean up on unmount - cancel any ongoing speech
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);
  
  // Helper function to configure an utterance (not exposed as a callback to avoid circular dependencies)
  function configureUtterance(text, options = {}) {
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Apply voice
    if (selectedVoiceRef.current) {
      utterance.voice = selectedVoiceRef.current;
    }
    
    // Apply options (rate, pitch, etc.)
    Object.keys(options).forEach(option => {
      if (option in utterance) {
        utterance[option] = options[option];
      }
    });
    
    return utterance;
  }
  
  // Function to speak text (defined outside useCallback to avoid circular dependencies)
  function speak(input, options = {}) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    let utteranceToSpeak;
    if (input instanceof SpeechSynthesisUtterance) {
      utteranceToSpeak = input;
      currentTextRef.current = utteranceToSpeak.text;
    } else {
      utteranceToSpeak = configureUtterance(input, options);
      currentTextRef.current = input;
    }
    
    // Reset position if starting new text
    currentPositionRef.current = 0;
    
    // Store original onend and add our state handling
    const originalOnEnd = utteranceToSpeak.onend;
    
    utteranceToSpeak.onend = (event) => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      
      if (typeof originalOnEnd === 'function') {
        originalOnEnd(event);
      }
    };
    
    // Handle errors
    utteranceToSpeak.onerror = () => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
    };
    
    // Handle boundary events to track position with enhanced word identification
    utteranceToSpeak.onboundary = (event) => {
      if (event.name === 'word') {
        currentPositionRef.current = event.charIndex;

        if (event.charIndex < currentTextRef.current.length) {
          // Determine the actual word using event.charIndex and look ahead/back for best match
          const text = currentTextRef.current;
          // Greedy match for a word using regex, anchored at pos
          let match = text.slice(event.charIndex).match(/^([\w'-]+)/);
          let currentWord = "";
          let wordStart = event.charIndex;
          let wordEnd = event.charIndex;
          if (match && match[1]) {
            currentWord = match[1];
            wordEnd = wordStart + currentWord.length;
          } else {
            // fallback: try to get the character at index if not whitespace/punct
            const char = text.charAt(event.charIndex);
            if (char && /\w/.test(char)) {
              currentWord = char;
              wordEnd = wordStart + 1;
            }
          }
          
          if (currentWord) {
            lastWordRef.current = currentWord;
            playbackContextRef.current.wordIndex = event.charIndex;
            currentWordDataRef.current = {
              word: currentWord,
              charIndex: wordStart,
              startTime: performance.now()
            };

            // Notify word boundary listeners with improved indices
            if (wordBoundaryListenersRef.current.length > 0) {
              const wordData = {
                word: currentWord,
                charIndex: wordStart,
                wordPosition: {
                  start: wordStart,
                  end: wordEnd
                },
                text: text,
                timestamp: performance.now()
              };

              wordBoundaryListenersRef.current.forEach(listener => {
                try {
                  listener(wordData);
                } catch (error) {
                  // eslint-disable-next-line no-console
                  console.error('Error in word boundary listener:', error);
                }
              });
            }
          }
        }
      }
    };
    
    // Store reference to current utterance
    utteranceRef.current = utteranceToSpeak;
    
    setSpeaking(true);
    setPaused(false);
    window.speechSynthesis.speak(utteranceToSpeak);
  }
  
  // Function to pause speech
  function pause() {
    if (typeof window === 'undefined' || !window.speechSynthesis || !speaking) return;
    
    window.speechSynthesis.pause();
    setPaused(true);
  }
  
  // Function to resume speech from where it was paused
  function resume() {
    if (typeof window === 'undefined' || !window.speechSynthesis || !paused) return;
    
    window.speechSynthesis.resume();
    setPaused(false);
  }
  
  // Function to cancel speech
  function cancel() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeaking(false);
    setPaused(false);
  }
  
  // Function to continue speaking from a specific position in the current text
  function speakFromPosition(charIndex, options = {}) {
    if (!currentTextRef.current || typeof charIndex !== 'number') return;
    
    // Create a new utterance starting from the specified position
    const remainingText = currentTextRef.current.substring(charIndex);
    
    // Create and configure utterance
    const utterance = configureUtterance(remainingText, options);
    
    // Update position tracking
    currentPositionRef.current = charIndex;
    
    // Update context with the new position
    playbackContextRef.current.wordIndex = charIndex;
    
    speak(utterance);
  }

  // PUBLIC_INTERFACE
  /**
   * Speak from a global character position in the provided document text, with chunk, voice, and speed control.
   * Enables seamless resume and highlight sync when switching voices/speeds/positions.
   * @param {number} globalCharIndex - Character offset in the entire document (absolute index)
   * @param {object} options - {
   *     text: string,           // full document text (required)
   *     chunks: Array<string>,  // array of text chunks (required, as from splitTextIntoChunks)
   *     voice: SpeechSynthesisVoice, // (optional) the voice to use
   *     rate: number,           // (optional) playback speed
   *     pitch: number,          // (optional) speech pitch
   *     volume: number          // (optional) speech volume
   *   }
   * @returns {void}
   */
  function speakFromGlobalPosition(globalCharIndex, options = {}) {
    // Validate input
    if (
      typeof globalCharIndex !== 'number' ||
      !options.text ||
      !Array.isArray(options.chunks)
    ) {
      return;
    }

    const { text, chunks, voice, rate, pitch, volume } = options;

    // Find target chunk and in-chunk position for globalCharIndex
    let accumulatedLength = 0;
    let targetChunkIndex = 0;
    let relativeIndex = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkLength = chunks[i].length;
      if (
        globalCharIndex >= accumulatedLength &&
        globalCharIndex < accumulatedLength + chunkLength
      ) {
        targetChunkIndex = i;
        relativeIndex = globalCharIndex - accumulatedLength;
        break;
      }
      accumulatedLength += chunkLength;
    }
    // Edge case: if char index is beyond last, play from end
    if (globalCharIndex >= accumulatedLength + (chunks[chunks.length - 1]?.length || 0)) {
      targetChunkIndex = chunks.length - 1;
      relativeIndex = Math.max(0, chunks[chunks.length - 1]?.length - 1);
    }

    // Cancel any active speech
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Build utterance config
    const chunkText = chunks[targetChunkIndex];
    const utterStart = relativeIndex;
    const textToSpeak = chunkText.substring(utterStart);

    // Choose voice
    let useVoice = null;
    if (voice) {
      useVoice = voice;
      selectedVoiceRef.current = voice;
    } else if (selectedVoiceRef.current) {
      useVoice = selectedVoiceRef.current;
    }

    // Compile utterance speech options
    const utterOpts = {
      rate: rate ?? 1,
      pitch: pitch ?? 1,
      volume: volume ?? 1,
    };

    // Create utterance and assign settings
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    if (useVoice) utterance.voice = useVoice;
    Object.keys(utterOpts).forEach(key => {
      if (utterOpts[key] !== undefined && key in utterance) utterance[key] = utterOpts[key];
    });

    // End handler: update speaking flags
    const handleEnd = () => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
    };
    utterance.onend = handleEnd;
    utterance.onerror = handleEnd;

    // Word boundary event: synchronize highlight using global char index
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        // Robustly calculate the global character index and spoken word for accurate highlight sync.
        const localCharIdx = event.charIndex;
        const globalIndex = accumulatedLength + utterStart + localCharIdx;

        // Extract the word using the actual uttered text segment.
        let wordMatch = '';
        let searchText = textToSpeak.slice(localCharIdx);
        // Match word characters robustly, allowing for apostrophes/hyphens.
        const match = searchText.match(/^([\w'-]+)/);
        if (match && match[1]) {
          wordMatch = match[1];
        } else {
          // as fallback, try to grab one char if not whitespace
          const charAt = searchText.charAt(0);
          if (charAt && /\w/.test(charAt)) {
            wordMatch = charAt;
          }
        }
        // Defensive fallback to previous word if no match at all
        if (!wordMatch) wordMatch = lastWordRef.current || '';

        // Store for downstream listeners
        lastWordRef.current = wordMatch;

        // For rare TTS sync quirks, keep currentPosition updated accurately
        currentPositionRef.current = globalIndex;

        currentWordDataRef.current = {
          word: wordMatch,
          charIndex: globalIndex,
          startTime: performance.now(),
        };
        if (wordBoundaryListenersRef.current.length > 0) {
          const wordData = {
            word: wordMatch,
            charIndex: globalIndex,
            wordPosition: {
              start: globalIndex,
              end: globalIndex + wordMatch.length,
            },
            text,
            timestamp: performance.now(),
          };
          wordBoundaryListenersRef.current.forEach(listener => {
            try {
              listener(wordData);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('Error in word boundary listener:', err);
            }
          });
        }
      }
    };

    // Store control refs for API
    utteranceRef.current = utterance;
    currentTextRef.current = chunkText;
    currentPositionRef.current = accumulatedLength + utterStart;

    playbackContextRef.current.chunkIndex = targetChunkIndex;
    playbackContextRef.current.wordIndex = accumulatedLength + utterStart;

    setSpeaking(true);
    setPaused(false);
    window.speechSynthesis.speak(utterance);
  }
  
  /**
   * Set the current playback context (page and chunk information)
   * @param {Object} context - Context object with page and chunk information
   */
  function setPlaybackContext(context = {}) {
    if (context.chunkIndex !== undefined) {
      playbackContextRef.current.chunkIndex = context.chunkIndex;
    }
    
    if (context.pageIndex !== undefined) {
      playbackContextRef.current.pageIndex = context.pageIndex;
    }
  }
  
  /**
   * Get the current playback context
   * @returns {Object} Current playback context
   */
  function getPlaybackContext() {
    return {
      ...playbackContextRef.current,
      currentPosition: currentPositionRef.current,
      lastWord: lastWordRef.current
    };
  }
  
  // Function to change the voice for speech synthesis
  function setVoice(voice) {
    if (!voice) return;
    
    selectedVoiceRef.current = voice;
    
    // If currently speaking or paused, switch voice without interrupting
    if (speaking && utteranceRef.current) {
      const currentPosition = currentPositionRef.current;
      const options = {
        rate: utteranceRef.current.rate,
        pitch: utteranceRef.current.pitch,
        volume: utteranceRef.current.volume
      };
      
      // Cancel the current speech
      window.speechSynthesis.cancel();
      
      // Get the remaining text
      const remainingText = currentTextRef.current.substring(currentPosition);
      
      // Create a new utterance with the new voice
      const utterance = configureUtterance(remainingText, options);
      
      // Store reference and update state
      utteranceRef.current = utterance;
      
      // Speak with the new voice
      window.speechSynthesis.speak(utterance);
    }
  }
  
  /**
   * Register a callback to be notified when a new word is spoken
   * @param {function} callback - Function to call when a new word boundary event occurs
   * @returns {function} Function to unregister the callback
   */
  const registerWordBoundaryListener = useCallback((callback) => {
    if (typeof callback !== 'function') return () => {};
    
    wordBoundaryListenersRef.current.push(callback);
    
    // Return a function to unregister this listener
    return () => {
      wordBoundaryListenersRef.current = wordBoundaryListenersRef.current.filter(
        listener => listener !== callback
      );
    };
  }, []);
  
  /**
   * Get current word data
   * @returns {Object} Current word data including the word and its position
   */
  const getCurrentWordData = useCallback(() => {
    return currentWordDataRef.current;
  }, []);

  return {
    speak,
    speaking,
    paused,
    pause,
    resume,
    cancel,
    voices,
    setVoice,
    speakFromPosition,
    // PUBLIC_INTERFACE
    speakFromGlobalPosition,
    currentPosition: currentPositionRef.current,
    setPlaybackContext,
    getPlaybackContext,
    lastWord: lastWordRef.current,
    registerWordBoundaryListener,
    getCurrentWordData
  };
};

export default useSpeechSynthesis;
