"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIService } from "@/lib/ai";

// Minimal typings for the browser Web Speech API (not in lib.dom for all browsers).
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechWindow = {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  isLoading: boolean;
}

/**
 * Two-tier voice capture:
 *   1. Preferred — MediaRecorder → POST /api/stt/transcribe (Groq Whisper).
 *      Higher accuracy on Arabic, works in any browser that supports
 *      MediaRecorder + getUserMedia.
 *   2. Fallback — browser-native SpeechRecognition (Web Speech API).
 *      Used when the server returns 503 (GROQ_API_KEY not set) or when
 *      the browser blocks mic access for the server flow but allows the
 *      built-in one.
 *
 * The microphone button has 4 visible states: idle / recording /
 * transcribing / unsupported.
 */
export function ChatInput({ value, onChange, onSend, isLoading }: ChatInputProps) {
  type MicState = "idle" | "recording" | "transcribing";
  const [micState, setMicState] = useState<MicState>("idle");
  const [unsupported, setUnsupported] = useState(false);

  // MediaRecorder path
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Fallback SpeechRecognition path
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // The SpeechRecognition handlers close over `value` at start time.
  // Keep a ref so each onresult appends onto the freshest text.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Cleanup on unmount — stop any active capture and release the mic.
  useEffect(() => {
    return () => {
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Text injection helper ────────────────────────────────────────
  const appendTranscript = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const prev = valueRef.current;
    const sep = prev && !prev.endsWith(" ") ? " " : "";
    onChange(prev + sep + clean);
  };

  // ── Path 2: Web Speech API fallback ──────────────────────────────
  const startSpeechRecognitionFallback = (): boolean => {
    const w = typeof window !== "undefined" ? (window as unknown as SpeechWindow) : null;
    const Ctor = w ? w.SpeechRecognition || w.webkitSpeechRecognition : undefined;
    if (!Ctor) return false;

    const rec = new Ctor();
    rec.lang = "ar-SA";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event: SpeechResultEvent) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) appendTranscript(finalText);
    };
    rec.onend = () => setMicState("idle");
    rec.onerror = () => setMicState("idle");

    try {
      rec.start();
      recognitionRef.current = rec;
      setMicState("recording");
      return true;
    } catch {
      setMicState("idle");
      return false;
    }
  };

  // ── Path 1: MediaRecorder + server STT ───────────────────────────
  const startMediaRecorder = async (): Promise<boolean> => {
    if (
      typeof window === "undefined" ||
      typeof MediaRecorder === "undefined" ||
      !navigator?.mediaDevices?.getUserMedia
    ) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Pick the most-compatible mime — Chromium emits webm/opus, Safari
      // emits mp4/aac. Let the browser pick if neither is supported.
      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];
      let mimeType: string | undefined;
      for (const m of mimeCandidates) {
        if (MediaRecorder.isTypeSupported(m)) {
          mimeType = m;
          break;
        }
      }

      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        chunksRef.current = [];

        if (blob.size < 800) {
          // Too short — likely an accidental tap. Skip the round-trip.
          setMicState("idle");
          return;
        }

        setMicState("transcribing");
        try {
          const text = await AIService.transcribe(blob, "ar");
          if (text === null) {
            // Server STT disabled — degrade to the browser path right now.
            const ok = startSpeechRecognitionFallback();
            if (!ok) setUnsupported(true);
            return;
          }
          appendTranscript(text);
        } catch (err) {
          console.error("[chat-input] STT failed:", err);
        } finally {
          setMicState("idle");
        }
      };

      rec.start();
      recorderRef.current = rec;
      setMicState("recording");
      return true;
    } catch (err) {
      // getUserMedia denied / no mic / etc. — try the browser fallback.
      console.warn("[chat-input] MediaRecorder unavailable:", err);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return false;
    }
  };

  // ── Public toggle the mic button calls ───────────────────────────
  const toggleRecording = async () => {
    if (micState === "recording") {
      // Stop whichever path is active.
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      return;
    }
    if (micState === "transcribing") return;

    const ok = await startMediaRecorder();
    if (ok) return;

    // MediaRecorder unavailable → try browser SpeechRecognition.
    const fallbackOk = startSpeechRecognitionFallback();
    if (!fallbackOk) setUnsupported(true);
  };

  const placeholder =
    micState === "recording"
      ? "جاري التسجيل... اضغط الميكروفون مرة أخرى للإنهاء"
      : micState === "transcribing"
        ? "جارٍ تحويل الصوت إلى نص…"
        : unsupported
          ? "اكتب استفسارك (التسجيل الصوتي غير مدعوم في هذا المتصفح)"
          : "اكتب استفسارك للمساعد الذكي...";

  const micTitle =
    micState === "recording"
      ? "إيقاف التسجيل"
      : micState === "transcribing"
        ? "جارٍ التحويل"
        : "إدخال صوتي";

  return (
    <div className="bg-card/80 backdrop-blur-xl border border-foreground/10 rounded-[32px] p-2 flex items-center gap-2 shadow-2xl">
      <button
        onClick={toggleRecording}
        disabled={micState === "transcribing"}
        title={micTitle}
        aria-label={micTitle}
        aria-pressed={micState === "recording"}
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shrink-0 disabled:opacity-60 disabled:cursor-not-allowed",
          micState === "recording"
            ? "text-red-400 bg-red-500/10 hover:bg-red-500/15 animate-pulse"
            : micState === "transcribing"
              ? "text-amber-700 dark:text-amber-300 bg-amber-500/10"
              : "text-muted hover:text-foreground hover:bg-foreground/5"
        )}
      >
        {micState === "transcribing" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
      </button>

      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSend();
        }}
        className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted px-2 text-[15px]"
        dir="rtl"
      />

      <button
        onClick={onSend}
        disabled={!value.trim() || isLoading}
        className="w-10 h-10 rounded-full bg-uqu-accent flex items-center justify-center text-white shrink-0 disabled:opacity-50 transition-all active:scale-95 hover:bg-uqu-accent/90 shadow-lg shadow-uqu-accent/20"
      >
        <Send className="w-4 h-4 rotate-180" />
      </button>
    </div>
  );
}
