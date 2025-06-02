import { useState, useEffect, useRef, useCallback } from 'react';
import { splitTextToWordSpans } from '../utils/documentUtils';
/**
 * Custom hook for using the Web Speech API for speech synthesis.
 * Enhanced with robust event handling, word boundary correction, and defensive (debounced/retry) mechanisms.
 * FIX: Adds timeouts/fallback for missing/late onboundary events, stuck speech playback, ghost/mismatch highlight recovery.
 */
const useSpeechSynthesis = () => {
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  // Defensive timeout refs for stuck playback/missing events
  const boundaryTimeoutRef = useRef(null);
  const stuckSpeechTimeoutRef = useRef(null);

  // Configurable watchdog timers
  const BOUNDARY_TIMEOUT_MS = 3000;
  const STUCK_SPEECH_TIMEOUT_MS = 12000;

  // Core live refs for utterance/etc
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

  // Cleanup helpers
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

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const getVoices = () => {
      const voiceOptions = window.speechSynthesis.getVoices();
      setVoices(voiceOptions);
      if (voiceOptions.length > 0 && !selectedVoiceRef.current) {
        selectedVoiceRef.current = voiceOptions.find(voice => voice.default) || voiceOptions[0];
      }
    };
    getVoices();
    window.speechSynthesis.onvoiceschanged = getVoices;
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Clean up any ongoing/leftover speech and ALL timeouts
  useEffect(() => {
    return () => {
      clearSpeechTimeouts();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function configureUtterance(text, options = {}) {
    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedVoiceRef.current) utterance.voice = selectedVoiceRef.current;
    Object.keys(options).forEach(option => {
      if (option in utterance) utterance[option] = options[option];
    });
    return utterance;
  }

  // Robust playback: watchdogs for stuck events, missing boundary, etc
  function speak(input, options = {}) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Cancel any ongoing speech, clear any existing timeouts
    window.speechSynthesis.cancel();
    clearSpeechTimeouts();

    let utteranceToSpeak;
    if (input instanceof SpeechSynthesisUtterance) {
      utteranceToSpeak = input;
      currentTextRef.current = utteranceToSpeak.text;
    } else {
      utteranceToSpeak = configureUtterance(input, options);
      currentTextRef.current = input;
    }
    currentPositionRef.current = 0;

    // Helper to force cancel on stuck playback
    const handleStuckSpeech = (reason = "Speech stuck or boundary missing") => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      clearSpeechTimeouts();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      // Mark to listeners (for App.js to clear highlights, reset UI, etc)
      wordBoundaryListenersRef.current.forEach(listener => {
        try { listener({ type: "stuck", reason }); } catch {}
      });
    };

    // Main onend handler
    const originalOnEnd = utteranceToSpeak.onend;
    utteranceToSpeak.onend = (event) => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      clearSpeechTimeouts();
      if (typeof originalOnEnd === 'function') originalOnEnd(event);
    };

    utteranceToSpeak.onerror = () => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      clearSpeechTimeouts();
      wordBoundaryListenersRef.current.forEach(listener => {
        try { listener({ type: "stuck", reason: "SpeechSynthesis error" }); } catch {}
      });
    };

    utteranceToSpeak.onboundary = (event) => {
      if (boundaryTimeoutRef.current) clearTimeout(boundaryTimeoutRef.current);
      boundaryTimeoutRef.current = setTimeout(() => {
        handleStuckSpeech(`No onboundary for ${BOUNDARY_TIMEOUT_MS}ms`);
      }, BOUNDARY_TIMEOUT_MS);

      if (event.name === 'word') {
        currentPositionRef.current = event.charIndex;
        if (event.charIndex < currentTextRef.current.length) {
          const text = currentTextRef.current;
          let match = text.slice(event.charIndex).match(/^([\w'-]+)/);
          let currentWord = "";
          let wordStart = event.charIndex;
          let wordEnd = event.charIndex;
          if (match && match[1]) {
            currentWord = match[1];
            wordEnd = wordStart + currentWord.length;
          } else {
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

    // Kick off a defensive stuck speech global timer in case we get no boundary/onend
    stuckSpeechTimeoutRef.current = setTimeout(() => {
      if (utteranceRef.current) {
        handleStuckSpeech(`Utterance ran over ${STUCK_SPEECH_TIMEOUT_MS}ms (likely stuck)`);
      }
    }, STUCK_SPEECH_TIMEOUT_MS);

    utteranceRef.current = utteranceToSpeak;
    setSpeaking(true);
    setPaused(false);
    window.speechSynthesis.speak(utteranceToSpeak);
  }

  function pause() {
    if (typeof window === 'undefined' || !window.speechSynthesis || !speaking) return;
    clearSpeechTimeouts();
    window.speechSynthesis.pause();
    setPaused(true);
  }
  function resume() {
    if (typeof window === 'undefined' || !window.speechSynthesis || !paused) return;
    clearSpeechTimeouts();
    window.speechSynthesis.resume();
    setPaused(false);
  }
  function cancel() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    clearSpeechTimeouts();
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeaking(false);
    setPaused(false);
  }

  // PUBLIC_INTERFACE
  function speakFromGlobalPosition(globalCharIndex, options = {}) {
    if (
      typeof globalCharIndex !== 'number' ||
      !options.text ||
      !Array.isArray(options.chunks)
    ) return;

    clearSpeechTimeouts();
    const { text, chunks, voice, rate, pitch, volume } = options;

    let canonicalWordOffset = globalCharIndex;
    let wordSpans = [];
    try {
      wordSpans = splitTextToWordSpans(text, 0);
      if (wordSpans.length > 0) {
        let found = null;
        for (let i = 0; i < wordSpans.length; i++) {
          const s = wordSpans[i];
          if (
            s.word &&
            typeof s.offset === 'number' &&
            globalCharIndex >= s.offset &&
            globalCharIndex < s.offset + s.text.length
          ) {
            found = s; break;
          }
        }
        if (found) {
          canonicalWordOffset = found.offset;
        } else {
          for (let i = 0; i < wordSpans.length; i++) {
            const s = wordSpans[i];
            if (s.word && typeof s.offset === 'number' && s.offset >= globalCharIndex) {
              canonicalWordOffset = s.offset; break;
            }
          }
        }
      }
    } catch (e) {
      canonicalWordOffset = globalCharIndex;
    }
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
    if (
      canonicalWordOffset >= accumulatedLength + (chunks[chunks.length - 1]?.length || 0)
    ) {
      targetChunkIndex = chunks.length - 1;
      relativeIndex = Math.max(0, chunks[chunks.length - 1]?.length - 1);
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const chunkText = chunks[targetChunkIndex];
    const utterStart = relativeIndex;
    const textToSpeak = chunkText.substring(utterStart);

    let useVoice = voice || selectedVoiceRef.current || null;
    if (voice) selectedVoiceRef.current = voice;

    const utterOpts = {
      rate: rate ?? 1,
      pitch: pitch ?? 1,
      volume: volume ?? 1,
    };
    const utterance = new window.SpeechSynthesisUtterance(textToSpeak);
    if (useVoice) utterance.voice = useVoice;
    Object.keys(utterOpts).forEach((key) => {
      if (utterOpts[key] !== undefined && key in utterance) utterance[key] = utterOpts[key];
    });
    let emittedOffsets = new Set();

    // Watchdog for stuck/missing boundary/onend
    const handleStuck = (reason = "Missing boundary/onend") => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      emittedOffsets.clear();
      clearSpeechTimeouts();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      wordBoundaryListenersRef.current.forEach(listener => {
        try { listener({ type: "stuck", reason }); } catch {}
      });
    };

    const handleEnd = () => {
      utteranceRef.current = null;
      setSpeaking(false);
      setPaused(false);
      emittedOffsets.clear();
      clearSpeechTimeouts();
    };
    utterance.onend = handleEnd;
    utterance.onerror = handleEnd;

    stuckSpeechTimeoutRef.current = setTimeout(() => {
      if (utteranceRef.current) {
        handleStuck(`Utterance stuck over ${STUCK_SPEECH_TIMEOUT_MS}`);
      }
    }, STUCK_SPEECH_TIMEOUT_MS);

    utterance.onboundary = (event) => {
      if (boundaryTimeoutRef.current) clearTimeout(boundaryTimeoutRef.current);
      boundaryTimeoutRef.current = setTimeout(() => {
        handleStuck(`No onboundary for ${BOUNDARY_TIMEOUT_MS}ms (speakFromGlobalPosition)`);
      }, BOUNDARY_TIMEOUT_MS);

      if (event.name === 'word') {
        const localCharIdx = event.charIndex;
        const globalIndex = accumulatedLength + utterStart + localCharIdx;

        let foundSpan = null;
        if (Array.isArray(wordSpans) && wordSpans.length > 0) {
          for (let i = 0; i < wordSpans.length; i++) {
            const span = wordSpans[i];
            if (
              span && typeof span.offset === 'number' && span.word &&
              globalIndex >= span.offset && globalIndex < span.offset + span.text.length
            ) {
              foundSpan = span; break;
            }
          }
          if (!foundSpan) {
            let best = null, closestDist = Infinity;
            for (let i = 0; i < wordSpans.length; i++) {
              const s = wordSpans[i];
              if (s && s.word && typeof s.offset === 'number' &&
                s.offset <= globalIndex &&
                globalIndex - s.offset < closestDist &&
                globalIndex - s.offset < 50
              ) {
                best = s; closestDist = globalIndex - s.offset;
              }
            }
            foundSpan = best;
          }
        }
        let wordMatch = '';
        let charIdx = globalIndex;
        if (foundSpan) { wordMatch = foundSpan.text; charIdx = foundSpan.offset; }
        else {
          const rawChar = typeof text === 'string' && globalIndex < text.length
            ? text.charAt(globalIndex) : '';
          wordMatch = /\w/.test(rawChar) ? rawChar : '';
          charIdx = globalIndex;
        }
        if (
          typeof wordMatch === 'string' && typeof charIdx === 'number' && text &&
          charIdx + wordMatch.length > text.length
        ) { wordMatch = ''; }
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
            try { listener(wordData); }
            catch (err) { /* swallow */ }
          });
        }
      }
    };

    utteranceRef.current = utterance;
    currentTextRef.current = chunkText;
    currentPositionRef.current = accumulatedLength + utterStart;
    playbackContextRef.current.chunkIndex = targetChunkIndex;
    playbackContextRef.current.wordIndex = accumulatedLength + utterStart;

    setSpeaking(true);
    setPaused(false);
    window.speechSynthesis.speak(utterance);
  }

  function setPlaybackContext(context = {}) {
    if (context.chunkIndex !== undefined) playbackContextRef.current.chunkIndex = context.chunkIndex;
    if (context.pageIndex !== undefined) playbackContextRef.current.pageIndex = context.pageIndex;
    if (context.wordIndex !== undefined) playbackContextRef.current.wordIndex = context.wordIndex;
  }
  function getPlaybackContext() {
    return {
      ...playbackContextRef.current,
      currentPosition: currentPositionRef.current,
      lastWord: lastWordRef.current
    };
  }
  function setVoice(voice) {
    if (!voice) return;
    selectedVoiceRef.current = voice;
    if (speaking && utteranceRef.current) {
      const currentPosition = currentPositionRef.current;
      const options = {
        rate: utteranceRef.current.rate,
        pitch: utteranceRef.current.pitch,
        volume: utteranceRef.current.volume
      };
      window.speechSynthesis.cancel();
      const remainingText = currentTextRef.current.substring(currentPosition);
      const utterance = configureUtterance(remainingText, options);
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }
  }
  const registerWordBoundaryListener = useCallback((callback) => {
    if (typeof callback !== 'function') return () => {};
    wordBoundaryListenersRef.current.push(callback);
    return () => {
      wordBoundaryListenersRef.current = wordBoundaryListenersRef.current.filter(
        listener => listener !== callback
      );
    };
  }, []);
  const getCurrentWordData = useCallback(() => {
    return currentWordDataRef.current;
  }, []);

  // PUBLIC_INTERFACE
  function clearAllSpeechContext() {
    clearSpeechTimeouts();
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
    speakFromPosition: () => {}, // legacy (not used)
    speakFromGlobalPosition,
    clearAllSpeechContext,
    // PUBLIC_INTERFACE: get current global audio char position
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
