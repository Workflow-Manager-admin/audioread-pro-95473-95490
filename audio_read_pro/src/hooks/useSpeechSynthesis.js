import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for using the Web Speech API for speech synthesis
 * Compatible with React 18+
 */
const useSpeechSynthesis = () => {
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  
  // Get available voices and update when the list changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    // Function to get and set voices
    const getVoices = () => {
      const voiceOptions = window.speechSynthesis.getVoices();
      setVoices(voiceOptions);
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
      if (typeof window !== 'undefined' && window.speechSynthesis && speaking) {
        window.speechSynthesis.cancel();
      }
    };
  }, [speaking]);
  
  // Function to speak text
  const speak = useCallback((utterance) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    const utteranceToSpeak = 
      utterance instanceof SpeechSynthesisUtterance
        ? utterance
        : new SpeechSynthesisUtterance(utterance);
    
    // Store original onend and add our state handling
    const originalOnEnd = utteranceToSpeak.onend;
    
    utteranceToSpeak.onend = (event) => {
      setSpeaking(false);
      if (typeof originalOnEnd === 'function') {
        originalOnEnd(event);
      }
    };
    
    // Handle errors
    utteranceToSpeak.onerror = () => {
      setSpeaking(false);
    };
    
    setSpeaking(true);
    window.speechSynthesis.speak(utteranceToSpeak);
  }, []);
  
  // Function to cancel speech
  const cancel = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    setSpeaking(false);
    window.speechSynthesis.cancel();
  }, []);
  
  return {
    speak,
    speaking,
    cancel,
    voices
  };
};

export default useSpeechSynthesis;
