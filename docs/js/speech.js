/**
 * en-GB Voice Dictation Helper (Web Speech API)
 *
 * Configures SpeechRecognition strictly for British English ('en-GB')
 * and falls back gracefully when a browser relies on OS/Gboard voice input.
 */

export function isSpeechRecognitionSupported() {
  return Boolean(
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

export class BritishDictationController {
  constructor() {
    this.recognition = null;
    this.activeThreadId = null;
    this.onFinalText = null;
    this.onInterimText = null;
    this.onStateChange = null;
    this.onError = null;
  }

  get isListening() {
    return Boolean(this.activeThreadId);
  }

  start({ threadId, onFinalText, onInterimText, onStateChange, onError }) {
    if (!isSpeechRecognitionSupported()) {
      onError?.('Browser voice dictation is unavailable here — tap the microphone icon on your Pixel keyboard to dictate in British English.');
      return false;
    }

    // If tapping the currently listening button, stop cleanly
    if (this.activeThreadId === threadId) {
      this.stop();
      return false;
    }

    if (this.recognition) {
      this.stop();
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    this.recognition = recognition;
    this.activeThreadId = threadId;
    this.onFinalText = onFinalText;
    this.onInterimText = onInterimText;
    this.onStateChange = onStateChange;
    this.onError = onError;

    recognition.onstart = () => {
      this.onStateChange?.({ listening: true, threadId });
    };

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          finalChunk += transcript;
        } else {
          interimChunk += transcript;
        }
      }

      if (finalChunk.trim()) {
        this.onFinalText?.(finalChunk.trim());
      }
      this.onInterimText?.(interimChunk.trim());
    };

    recognition.onerror = (event) => {
      const code = event?.error || 'unknown';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        this.onError?.('Microphone permission was denied. Allow microphone access in Chrome or use your Pixel keyboard dictation button.');
      } else if (code !== 'aborted' && code !== 'no-speech') {
        this.onError?.(`Voice dictation paused (${code}). You can tap Dictate again or use your keyboard microphone.`);
      }
      this.stop();
    };

    recognition.onend = () => {
      const prevThread = this.activeThreadId;
      this.recognition = null;
      this.activeThreadId = null;
      this.onInterimText?.('');
      this.onStateChange?.({ listening: false, threadId: prevThread });
    };

    try {
      recognition.start();
      return true;
    } catch (err) {
      this.stop();
      onError?.(err instanceof Error ? err.message : 'Unable to start voice dictation.');
      return false;
    }
  }

  stop() {
    const rec = this.recognition;
    const prevThread = this.activeThreadId;
    this.recognition = null;
    this.activeThreadId = null;
    this.onInterimText?.('');
    if (rec) {
      try {
        rec.stop();
      } catch {
        // Already stopped
      }
    }
    this.onStateChange?.({ listening: false, threadId: prevThread });
  }
}
