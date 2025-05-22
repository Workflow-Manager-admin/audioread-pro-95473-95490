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
        
        // Store information about the current word being spoken
        if (event.charIndex < currentTextRef.current.length) {
          // Extract the current word
          const text = currentTextRef.current;
          const wordStart = event.charIndex;
          const nextSpace = text.indexOf(' ', wordStart);
          const wordEnd = nextSpace !== -1 ? nextSpace : text.length;
          const currentWord = text.substring(wordStart, wordEnd).trim();
          
          if (currentWord) {
            lastWordRef.current = currentWord;
            
            // Update word index in context
            playbackContextRef.current.wordIndex = event.charIndex;
            
            // Update current word data with timing information
            currentWordDataRef.current = {
              word: currentWord,
              charIndex: event.charIndex,
              startTime: performance.now()
            };
            
            // Notify all registered word boundary listeners
            if (wordBoundaryListenersRef.current.length > 0) {
              const wordData = {
                word: currentWord,
                charIndex: event.charIndex,
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
    currentPosition: currentPositionRef.current,
    setPlaybackContext,
    getPlaybackContext,
    lastWord: lastWordRef.current
  };
};

export default useSpeechSynthesis;
