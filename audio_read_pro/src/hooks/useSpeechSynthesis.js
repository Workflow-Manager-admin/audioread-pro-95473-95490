import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for using the Web Speech API for speech synthesis
 * Enhanced with pause/resume and voice switching capabilities
 */
const useSpeechSynthesis = () => {
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  
  // Track the current utterance and text position
  const utteranceRef = useRef(null);
  const currentTextRef = useRef('');
  const currentPositionRef = useRef(0);
  const selectedVoiceRef = useRef(null);
  
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
  
  /**
   * Creates an utterance with the specified text and settings
   * @param {string} text - The text to speak
   * @param {object} options - Configuration options like rate, pitch, etc.
   * @returns {SpeechSynthesisUtterance} - The configured utterance
   */
  const createUtterance = useCallback((text, options = {}) => {
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
  }, []);
  
  /**
   * Function to speak text
   * @param {string|SpeechSynthesisUtterance} input - Text to speak or utterance object
   * @param {object} options - Options like rate, pitch, etc.
   */
  const speak = useCallback((input, options = {}) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    let utteranceToSpeak;
    if (input instanceof SpeechSynthesisUtterance) {
      utteranceToSpeak = input;
      currentTextRef.current = utteranceToSpeak.text;
    } else {
      utteranceToSpeak = createUtterance(input, options);
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
    
    // Handle boundary events to track position
    utteranceToSpeak.onboundary = (event) => {
      if (event.name === 'word') {
        currentPositionRef.current = event.charIndex;
      }
    };
    
    // Store reference to current utterance
    utteranceRef.current = utteranceToSpeak;
    
    setSpeaking(true);
    setPaused(false);
    window.speechSynthesis.speak(utteranceToSpeak);
  }, [createUtterance]);
  
  /**
   * Function to pause speech
   */
  const pause = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !speaking) return;
    
    window.speechSynthesis.pause();
    setPaused(true);
  }, [speaking]);
  
  /**
   * Function to resume speech from where it was paused
   */
  const resume = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !paused) return;
    
    window.speechSynthesis.resume();
    setPaused(false);
  }, [paused]);
  
  /**
   * Function to cancel speech
   */
  const cancel = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeaking(false);
    setPaused(false);
  }, []);
  
  /**
   * Function to continue speaking from a specific position in the current text
   * @param {number} charIndex - Character index to start from
   * @param {object} options - Options like rate, pitch, etc.
   */
  const speakFromPosition = useCallback((charIndex, options = {}) => {
    if (!currentTextRef.current || typeof charIndex !== 'number') return;
    
    // Create a new utterance starting from the specified position
    const remainingText = currentTextRef.current.substring(charIndex);
    
    // Create utterance directly instead of using createUtterance to avoid circular dependency
    const utterance = new SpeechSynthesisUtterance(remainingText);
    
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
    
    // Update position tracking
    currentPositionRef.current = charIndex;
    
    speak(utterance);
  }, [speak]);
  
  /**
   * Function to change the voice for speech synthesis
   * @param {SpeechSynthesisVoice} voice - The voice to use
   */
  const setVoice = useCallback((voice) => {
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
      
      // Cancel the current speech and start with new voice
      window.speechSynthesis.cancel();
      
      // Create utterance directly to avoid dependency issues
      const remainingText = currentTextRef.current.substring(currentPosition);
      const utterance = new SpeechSynthesisUtterance(remainingText);
      
      // Apply the new voice
      utterance.voice = voice;
      
      // Apply other options
      Object.keys(options).forEach(option => {
        if (option in utterance) {
          utterance[option] = options[option];
        }
      });
      
      // Store reference and update state
      utteranceRef.current = utterance;
      
      // Speak with new voice
      window.speechSynthesis.speak(utterance);
    }
  }, [speaking]);
  
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
    currentPosition: currentPositionRef.current
  };
};

export default useSpeechSynthesis;
