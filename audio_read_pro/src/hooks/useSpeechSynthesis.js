import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for using the Web Speech API for speech synthesis
 * Compatible with React 18+
 */
const useSpeechSynthesis = () => {
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      setSupported(true);
      
      // Get initial list of voices
      const getVoices = () => {
        const voiceOptions = window.speechSynthesis.getVoices();
        setVoices(voiceOptions);
      };
      
      getVoices();
      
      // Chrome loads voices asynchronously
      window.speechSynthesis.onvoiceschanged = getVoices;
      
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);
  
  const speak = useCallback((utterance) => {
    if (!supported) return;
    
    setSpeaking(true);
    
    const handleEnd = () => {
      setSpeaking(false);
      if (utterance.onend && typeof utterance.onend === 'function') {
        utterance.onend();
      }
    };
    
    // If a SpeechSynthesisUtterance is not provided, create one
    const utteranceToSpeak = 
      utterance instanceof SpeechSynthesisUtterance
        ? utterance
        : new SpeechSynthesisUtterance(utterance);
    
    // Keep track of original onend and add our state handling
    const originalOnEnd = utteranceToSpeak.onend;
    utteranceToSpeak.onend = (event) => {
      handleEnd();
      if (originalOnEnd) originalOnEnd(event);
    };
    
    window.speechSynthesis.speak(utteranceToSpeak);
  }, [supported]);
  
  const cancel = useCallback(() => {
    if (!supported) return;
    setSpeaking(false);
    window.speechSynthesis.cancel();
  }, [supported]);
  
  return {
    supported,
    speak,
    speaking,
    cancel,
    voices
  };
};

export default useSpeechSynthesis;
