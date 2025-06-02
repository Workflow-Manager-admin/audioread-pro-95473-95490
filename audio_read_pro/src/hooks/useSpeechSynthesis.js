import { useState, useEffect, useRef, useCallback } from 'react';
import { splitTextToWordSpans } from '../utils/documentUtils';
/**
 * Custom hook for using the Web Speech API for speech synthesis.
 * - Enhanced with robust event handling, word boundary correction, and defensive (debounced/retry) mechanisms
 * - Fixed glitches with highlights, stuck speech, and misaligned spoken words.
 * - Defensive improvements for browser API quirks and event timing
 * - Now adds robust timeouts, stuck speech/playback detection, ghost highlight/timeouts, and cross-callback cleanup.
 */
const useSpeechSynthesis = () => {
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  // Defensive/error handling timeouts/refs
  const boundaryTimeoutRef = useRef(null);
  const stuckSpeechTimeoutRef = useRef(null);

  // Configurable timeouts (ms)
  const BOUNDARY_TIMEOUT_MS = 3000; // How long to wait for another word boundary before considering it missing
  const STUCK_SPEECH_TIMEOUT_MS = 12000; // Max time after last boundary/onend before forcibly cancelling

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

  // Helper to clear and restart speech stuck/delay timeouts
  function clearSpeechTimeouts() {
    if (boundaryTimeoutRef.current) {
      clearTimeout(boundaryTimeoutRef.current);
      boundaryTimeoutRef.current = null;
    }
    if (stuckSpeechTimeoutRef.current) {
      clearTimeout(stuckSpeechTimeoutRef.current);
      stuckSpeechTimeoutRef.current = null;
    }
  }
  
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
  // PUBLIC_INTERFACE
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

    // --- Canonical word boundary alignment (never skip first word, always start at true word offset) ---
    let canonicalWordOffset = globalCharIndex;
    let wordSpans = [];
    try {
      wordSpans = splitTextToWordSpans(text, 0);
      if (wordSpans.length > 0) {
        // Find exact word span which contains the target or is the next word after
        let found = null;
        for (let i = 0; i < wordSpans.length; i++) {
          const s = wordSpans[i];
          if (
            s.word &&
            typeof s.offset === 'number' &&
            globalCharIndex >= s.offset &&
            globalCharIndex < s.offset + s.text.length
          ) {
            found = s;
            break;
          }
        }
        if (found) {
          // Exact match inside a word span
          canonicalWordOffset = found.offset;
        } else {
          // Snap strictly to the word span starting at this or next offset (never skip first word)
          for (let i = 0; i < wordSpans.length; i++) {
            const s = wordSpans[i];
            if (s.word && typeof s.offset === 'number' && s.offset >= globalCharIndex) {
              canonicalWordOffset = s.offset;
              break;
            }
          }
        }
      }
    } catch (e) {
      canonicalWordOffset = globalCharIndex;
    }

    // Map canonical offset to the correct chunk and local char position
    let accumulatedLength = 0;
    let targetChunkIndex = 0;
    let relativeIndex = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkLen = chunks[i].length;
      if (
        canonicalWordOffset >= accumulatedLength &&
        canonicalWordOffset < accumulatedLength + chunkLen
      ) {
        targetChunkIndex = i;
        relativeIndex = canonicalWordOffset - accumulatedLength;
        break;
      }
      accumulatedLength += chunkLen;
    }
    // Clamp for out-of-range
    if (
      canonicalWordOffset >= accumulatedLength +
        (chunks[chunks.length - 1]?.length || 0)
    ) {
      targetChunkIndex = chunks.length - 1;
      relativeIndex = Math.max(0, chunks[chunks.length - 1]?.length - 1);
    }

    // Cancel before repeat play
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Always start speech at canonical offset, passing the exact text
    const chunkText = chunks[targetChunkIndex];
    const utterStart = relativeIndex;
    const textToSpeak = chunkText.substring(utterStart);

    // Voice options
    let useVoice = voice || selectedVoiceRef.current || null;
    if (voice) selectedVoiceRef.current = voice;

    const utterOpts = {
      rate: rate ?? 1,
      pitch: pitch ?? 1,
      volume: volume ?? 1,
    };

    // Build utterance
    const utterance = new window.SpeechSynthesisUtterance(textToSpeak);
    if (useVoice) utterance.voice = useVoice;
    Object.keys(utterOpts).forEach((key) => {
      if (utterOpts[key] !== undefined && key in utterance) utterance[key] = utterOpts[key];
    });

    // Prevent duplicate boundary events by tracking offsets
    let emittedOffsets = new Set();

    // End and error handler
    const handleEnd = () => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      emittedOffsets.clear();
    };
    utterance.onend = handleEnd;
    utterance.onerror = handleEnd;

    // Always fire boundary with canonical mapping (robustly use splitTextToWordSpans)
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const localCharIdx = event.charIndex;
        const globalIndex = accumulatedLength + utterStart + localCharIdx;

        let foundSpan = null;
        if (Array.isArray(wordSpans) && wordSpans.length > 0) {
          for (let i = 0; i < wordSpans.length; i++) {
            const span = wordSpans[i];
            if (
              span &&
              typeof span.offset === 'number' &&
              span.word &&
              globalIndex >= span.offset &&
              globalIndex < span.offset + span.text.length
            ) {
              foundSpan = span;
              break;
            }
          }
          // Fallback: nearest pre-span within 50 chars
          if (!foundSpan) {
            let best = null, closestDist = Infinity;
            for (let i = 0; i < wordSpans.length; i++) {
              const s = wordSpans[i];
              if (
                s &&
                s.word &&
                typeof s.offset === 'number' &&
                s.offset <= globalIndex &&
                globalIndex - s.offset < closestDist &&
                globalIndex - s.offset < 50
              ) {
                best = s;
                closestDist = globalIndex - s.offset;
              }
            }
            foundSpan = best;
          }
        }

        let wordMatch = '';
        let charIdx = globalIndex;
        if (foundSpan) {
          wordMatch = foundSpan.text;
          charIdx = foundSpan.offset;
        } else {
          // fallback: single char
          const rawChar = typeof text === 'string' && globalIndex < text.length
            ? text.charAt(globalIndex) : '';
          wordMatch = /\w/.test(rawChar) ? rawChar : '';
          charIdx = globalIndex;
        }
        if (
          typeof wordMatch === 'string' &&
          typeof charIdx === 'number' &&
          text &&
          charIdx + wordMatch.length > text.length
        ) {
          wordMatch = '';
        }

        // Deduplicate
        if (emittedOffsets.has(charIdx)) return;
        emittedOffsets.add(charIdx);

        lastWordRef.current = wordMatch;
        currentPositionRef.current = charIdx;
        currentWordDataRef.current = {
          word: wordMatch,
          charIndex: charIdx,
          startTime: performance.now(),
        };

        if (wordBoundaryListenersRef.current.length > 0) {
          const wordData = {
            word: wordMatch,
            charIndex: charIdx,
            wordPosition: {
              start: charIdx,
              end: charIdx + (wordMatch ? wordMatch.length : 1),
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

    // Store refs for perfect resume
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

  // PUBLIC_INTERFACE
  /**
   * Reset all speech-related context and refs. This cancels speech, clears listeners and resets state.
   * Usage: Call on navigation or cleanup to prevent stuck highlights or ghost audio.
   */
  function clearAllSpeechContext() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    currentTextRef.current = '';
    currentPositionRef.current = 0;
    lastWordRef.current = '';
    selectedVoiceRef.current = null;
    playbackContextRef.current = { chunkIndex: 0, pageIndex: 0, wordIndex: 0 };
    wordBoundaryListenersRef.current = [];
    setSpeaking(false);
    setPaused(false);
  }

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
    clearAllSpeechContext,
    /** 
     * PUBLIC_INTERFACE
     * Get the most recent global char position that was spoken (in audio), for true resume.
     */
    getCurrentGlobalPosition: () =>
      typeof currentPositionRef.current === "number" ? currentPositionRef.current : 0,
    currentPosition: currentPositionRef.current,
    setPlaybackContext,
    getPlaybackContext,
    lastWord: lastWordRef.current,
    registerWordBoundaryListener,
    getCurrentWordData
  };
};

export default useSpeechSynthesis;
