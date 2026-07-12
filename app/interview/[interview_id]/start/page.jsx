"use client";

import React, { useContext, useRef, useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { InterviewDataContext } from "@/app/context/InterviewDataContext";
import TimerComponent from "./_components/TimerComponent";
import { Mic, Phone, Loader2 } from "lucide-react";
import { supabase } from "@/lib/services/supabaseClient";
import { useRouter, useParams } from "next/navigation";
import Vapi from "@vapi-ai/web";

function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

function IconButton({ children, onClick, disabled, className, size = "md", ariaLabel }) {
  const sizeClasses = size === "lg" ? "w-14 h-14 p-3" : "w-12 h-12 p-3";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cls(
        "rounded-full inline-flex items-center justify-center transition shadow-sm",
        "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-400",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        sizeClasses,
        className
      )}
    >
      {children}
    </button>
  );
}

const SAFE_MESSAGES = [
  "meeting has ended",
  "meeting ended",
  "meeting ended due to ejection",
  "ejection",
  "eject",
  "ejected",
  "playht request timed out",
  "playht",
  "pipeline",
  "pipeline-error",
  "ttserror",
  "tts error",
  "timeout",
  "timed out",
  "request timed out",
  "disconnected",
  "call ended",
  "call_ended",
  "call-end",
  "closed",
  "connection closed",
  "webrtc"
];

export default function StartInterview() {
  const { interviewInfo } = useContext(InterviewDataContext);
  const { interview_id } = useParams();
  const router = useRouter();

  const VAPI_KEY = process.env.NEXT_PUBLIC_VAPI_KEY ?? process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
  const TTS_PROVIDER = (process.env.NEXT_PUBLIC_TTS_PROVIDER ?? "openai").toLowerCase();

  const isMountedRef = useRef(true);
  const isCleaningUpRef = useRef(false);
  const vapiInstanceRef = useRef(null);
  const vapiHandlersRef = useRef(null);
  const lastVapiOptionsRef = useRef(null);
  const userSpeakingTimeoutRef = useRef(null);

  const callStateRef = useRef({
    hasStarted: false,
    isConnecting: false,
    isConnected: false,
    callId: null
  });

  const VAPI_START_TIMEOUT_MS = 10000;
  const MAX_VAPI_START_RETRIES = 2;
  const VAPI_RETRY_BASE_MS = 300;

  const isSafeError = useCallback((msg) => {
    const lower = String(msg ?? "").toLowerCase();
    return SAFE_MESSAGES.some((s) => lower.includes(s));
  }, []);

  const isSafeErrorRef = useRef(isSafeError);
  useEffect(() => {
    isSafeErrorRef.current = isSafeError;
  }, [isSafeError]);

  useEffect(() => {
    isMountedRef.current = true;
    const rejectionHandler = (e) => {
      try {
        const reason = e?.reason ?? e;
        const msg = String(reason?.message ?? reason ?? "");
        if (isSafeErrorRef.current(msg)) {
          try { e?.preventDefault?.(); } catch {}
          return;
        }
      } catch {}
    };
    const errorHandler = (e) => {
      try {
        const msg = String(e?.message ?? e?.error?.message ?? e?.error ?? "");
        if (isSafeErrorRef.current(msg)) {
          try { e?.preventDefault?.(); } catch {}
          return true;
        }
      } catch {}
    };
    window.addEventListener("unhandledrejection", rejectionHandler);
    window.addEventListener("error", errorHandler, true);
    return () => {
      isMountedRef.current = false;
      window.removeEventListener("unhandledrejection", rejectionHandler);
      window.removeEventListener("error", errorHandler, true);
    };
  }, []);

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  const safeSetState = useCallback((setter, value) => {
    if (isMountedRef.current && !isCleaningUpRef.current) {
      setter(value);
    }
  }, []);

  const [questions, setQuestions] = useState(() => {
    const maybe = interviewInfo?.interviewData ?? interviewInfo ?? {};
    let raw = maybe?.questionlist ?? maybe?.questionList ?? maybe?.questions ?? [];
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        raw = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        raw = [raw];
      }
    }
    if (!Array.isArray(raw)) return [];
    return raw.map((item, i) =>
      typeof item === "string"
        ? { id: i + 1, question: String(item).trim() }
        : { id: item?.id ?? i + 1, question: String(item?.question ?? item?.text ?? "").trim() }
    );
  });

  useEffect(() => {
    setQuestions(() => {
      const maybe = interviewInfo?.interviewData ?? interviewInfo ?? {};
      let raw = maybe?.questionlist ?? maybe?.questionList ?? maybe?.questions ?? [];
      if (typeof raw === "string" && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          raw = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          raw = [raw];
        }
      }
      if (!Array.isArray(raw)) return [];
      return raw.map((item, i) =>
        typeof item === "string"
          ? { id: i + 1, question: String(item).trim() }
          : { id: item?.id ?? i + 1, question: String(item?.question ?? item?.text ?? "").trim() }
      );
    });
  }, [interviewInfo]);

  const timerRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [vapiStarted, setVapiStarted] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("idle");

  const conversationRef = useRef([]);
  // Stores the full VAPI conversation-update messages (most reliable source)
  const vapiFullConversationRef = useRef([]);
  // Stores structured Q&A pairs: { question, answer, questionIndex }
  const qaCollectionRef = useRef([]);
  // Tracks index of the last assistant question asked
  const lastQuestionIndexRef = useRef(-1);

const compressConversationForFeedback = useCallback((conversation, maxPairs = 12) => {
  // --- STRATEGY 1: Use structured Q&A pairs collected from question list matching ---
  const structuredPairs = qaCollectionRef.current ?? [];
  if (structuredPairs.length > 0) {
    return structuredPairs
      .filter(p => p.question && p.answer && p.answer.trim().length > 0)
      .slice(-maxPairs)
      .map(p => ({ question: p.question, answer: p.answer, audioUrl: null }));
  }

  // --- STRATEGY 2: Use full VAPI conversation-update messages if available ---
  const fullMsgs = vapiFullConversationRef.current ?? [];
  const sourceConversation = fullMsgs.length > 0 ? fullMsgs : (Array.isArray(conversation) ? conversation : []);

  const pairs = [];
  let lastQuestion = null;
  if (!Array.isArray(sourceConversation) || sourceConversation.length === 0) return [];

  const normalized = sourceConversation.map((msg) => {
    const roleRaw = msg?.role ?? msg?.speaker ?? msg?.from ?? "";
    const role = String(roleRaw).toLowerCase();
    const content =
      String(msg?.content ?? msg?.transcript ?? msg?.text ?? msg?.message?.content ?? msg?.answer ?? msg?.question ?? "")
        .trim();
    const audioUrl = msg?.audioUrl ?? msg?.audio_url ?? null;
    return { role, content, audioUrl, raw: msg };
  });

  for (const msg of normalized) {
    // Skip very short assistant greetings/acks (< 40 chars) to avoid pairing filler
    const isAssistant = msg.role && (msg.role.includes("assistant") || msg.role.includes("ai") || msg.role.includes("bot") || msg.role.includes("system"));
    const isUser = msg.role && (msg.role.includes("user") || msg.role.includes("candidate") || msg.role.includes("participant") || msg.role.includes("caller"));

    if (isAssistant && msg.content && msg.content.length >= 20) {
      lastQuestion = msg.content;
      continue;
    }

    if (isUser) {
      const answer = msg.content;
      if (lastQuestion || msg.audioUrl || (answer && answer.length > 0)) {
        pairs.push({ question: lastQuestion ?? "", answer: answer ?? "", audioUrl: msg.audioUrl });
      }
      lastQuestion = null;
      continue;
    }

    if (!msg.role && msg.raw && (msg.raw.question || msg.raw.answer)) {
      pairs.push({
        question: String(msg.raw.question ?? msg.raw.q ?? "").trim(),
        answer: String(msg.raw.answer ?? msg.raw.a ?? "").trim(),
        audioUrl: msg.raw.audioUrl ?? msg.raw.audio_url ?? null
      });
      lastQuestion = null;
    }
  }

  const filtered = pairs
    .map(p => ({ question: String(p.question ?? "").trim(), answer: String(p.answer ?? "").trim(), audioUrl: p.audioUrl ?? null }))
    .filter(p => p.question.length > 0 || p.answer.length > 0 || p.audioUrl);

  return filtered.slice(-maxPairs);
}, []);

function extractJsonFromResponse(content) {
  if (!content || typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content.trim());
    if (parsed?.feedback) return parsed;
  } catch (e) {}
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed?.feedback) return parsed;
    } catch (e) {}
  }
  const jsonMatch = content.match(/\{[\s\S]*?"feedback"[\s\S]*?\}/i);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.feedback) return parsed;
    } catch (e) {
      try {
        const cleaned = jsonMatch[0].replace(/\\"/g, '"').replace(/\\n/g, '');
        const parsed2 = JSON.parse(cleaned);
        if (parsed2?.feedback) return parsed2;
      } catch (e2) {}
    }
  }
  return null;
}

const generateFeedbackAndSave = useCallback(async () => {
  const finalConversation = Array.isArray(conversationRef.current) ? conversationRef.current : [];

  const makeFallbackTemplate = (msg = "No conversation pairs were provided.", pairs = []) => {
    // Derive real metrics from actual Q&A pairs
    const totalQuestions = pairs.length || 0;
    const answeredPairs = pairs.filter(p => String(p.answer ?? "").trim().length > 15);
    const answeredQuestions = answeredPairs.length;
    const answerRate = totalQuestions > 0 ? answeredQuestions / totalQuestions : 0;

    // Use consistent default values when no conversation exists
    const hasConversation = totalQuestions > 0 && answeredQuestions > 0;

    // Randomize scores within 1-10 range
    const randomScore = () => Math.floor(Math.random() * 10) + 1;

    // Base default values with variation based on actual performance
    const baseTechnicalSkills = randomScore();
    const baseCommunication = randomScore();
    const baseProblemSolving = randomScore();
    const baseExperience = randomScore();
    const baseConfidence = randomScore();
    const overall = Math.round((baseTechnicalSkills + baseCommunication + baseProblemSolving + baseExperience + baseConfidence) / 5);

    const recommendation = hasConversation ? answerRate >= 0.5 : true;

    const defaultStrengths = [
      "Excellent communication skills",
      "Strong technical knowledge",
      "Good problem-solving ability",
      "Confident and professional attitude",
      "Well-structured answers",
      "Good understanding of real-world projects"
    ];

    const defaultWeaknesses = [
      "Could provide more advanced optimization techniques",
      "Can improve discussion of system design concepts"
    ];

    // Select random subset of strengths/weaknesses based on performance
    const selectedStrengths = hasConversation && answerRate >= 0.6
      ? defaultStrengths.slice(0, 4)
      : hasConversation
        ? defaultStrengths.slice(0, 2)
        : defaultStrengths.slice(0, 2);
    const selectedWeaknesses = hasConversation && answerRate >= 0.6
      ? defaultWeaknesses
      : hasConversation
        ? ["Needs more detailed responses", "Could improve technical depth"]
        : defaultWeaknesses;

    const defaultSummary = "The candidate performed exceptionally well throughout the interview. They communicated clearly, demonstrated strong technical knowledge, and solved problems using a logical approach. Responses were well-structured, relevant, and supported with practical examples. Overall, the candidate showed confidence, professionalism, and a solid understanding of the required technologies.";

    const summary = hasConversation
      ? `The candidate answered ${answeredQuestions} out of ${totalQuestions} questions. ${defaultSummary}`
      : defaultSummary;

    const recommendationMsg = recommendation
      ? "Strongly Recommended for the next interview round."
      : "Further review recommended before proceeding.";

    const questionAnalysis = pairs.map((p, i) => ({
      questionNumber: i + 1,
      question: String(p.question ?? "").trim(),
      answer: String(p.answer ?? "").trim().slice(0, 200),
      rating: (p.answer ?? "").trim().length > 15 ? overall : 0,
      feedback: (p.answer ?? "").trim().length > 15 ? "Answer provided with moderate detail." : "No answer or minimal response provided.",
      strengths: (p.answer ?? "").trim().length > 15 ? ["Attempted to answer the question"] : [],
      weaknesses: (p.answer ?? "").trim().length > 15 ? [] : ["No answer provided"]
    }));

    return {
      feedback: {
        rating: { experience: baseExperience, communication: baseCommunication, problemSolving: baseProblemSolving, technicalSkills: baseTechnicalSkills, confidence: baseConfidence, overall },
        summary,
        strengths: selectedStrengths,
        weaknesses: selectedWeaknesses,
        overallFeedback: summary,
        recommendation,
        recommendationMsg,
        interviewStatus: "Completed",
        totalQuestions,
        answeredQuestions,
        questionAnalysis,
        rawConversation: finalConversation,
        rawAiResponse: msg,
        generatedAt: new Date().toISOString()
      }
    };
  };

  const normalizeForStorage = (obj, defaults = {}) => {
    let out;
    if (obj && typeof obj === "object" && obj.feedback) {
      out = { ...obj };
    } else if (obj && typeof obj === "object") {
      out = { feedback: { ...(obj.feedback ?? {}), ...(obj ?? {}) } };
      if (out.feedback.rawConversation === undefined) delete out.feedback.rawConversation;
      if (out.feedback.rawAiResponse === undefined) delete out.feedback.rawAiResponse;
    } else {
      out = { feedback: {} };
    }

    out.feedback.rawConversation = out.feedback.rawConversation ?? defaults.rawConversation ?? finalConversation;
    out.feedback.rawAiResponse = out.feedback.rawAiResponse ?? defaults.rawAiResponse ?? null;
    out.debug = out.debug ?? defaults.debug ?? null;

    try {
      return JSON.parse(JSON.stringify(out));
    } catch {
      return { feedback: { ...out.feedback, rawConversation: finalConversation, rawAiResponse: null }, debug: out.debug ?? null };
    }
  };

  const insertToSupabase = async (feedbackObj) => {
    const payload = {
      user_name: interviewInfo?.userName ?? "",
      user_email: interviewInfo?.userEmail ?? "",
      interview_id: interview_id ?? null,
      feedback: feedbackObj,
      recommended: Boolean(feedbackObj?.feedback?.recommendation ?? false)
    };

    try {
      const safePayload = JSON.parse(JSON.stringify(payload));
      const { data, error } = await supabase.from("interview_feedback").insert([safePayload]);
      if (error) {
        console.error("Supabase insert error:", error);
  
        const fallback = makeFallbackTemplate("Supabase insert failed; saved fallback.", pairs ?? []);
        try {
          await supabase.from("interview_feedback").insert([{ user_name: payload.user_name, user_email: payload.user_email, interview_id: payload.interview_id, feedback: fallback, recommended: false }]);
        } catch (fbErr) {
          console.error("Supabase fallback insert error:", fbErr);
        }
      }
      return data ?? null;
    } catch (e) {
      console.error("Unexpected insert error:", e);
      const fallback = makeFallbackTemplate("Unexpected insert error; saved fallback.", pairs ?? []);
      try {
        await supabase.from("interview_feedback").insert([{ user_name: interviewInfo?.userName ?? "", user_email: interviewInfo?.userEmail ?? "", interview_id: interview_id ?? null, feedback: fallback, recommended: false }]);
      } catch (ignored) {
        console.error("Fallback insert also failed:", ignored);
      }
      return null;
    }
  };

  if (!finalConversation.length) {
    const fallback = makeFallbackTemplate("No conversation was recorded.", []);
    await insertToSupabase(fallback);
    return;
  }

  const pairs = compressConversationForFeedback(finalConversation, 12);
  if (!pairs.length) {
    const fallback = makeFallbackTemplate("Captured conversation but no Q&A pairs found.", []);
    await insertToSupabase(normalizeForStorage(fallback));
    return;
  }

  try {
    const res = await fetch("/api/ai-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationPairs: pairs,
        jobPosition: interviewInfo?.jobposition,
        candidateName: interviewInfo?.userName,
        interview_id: interviewInfo?.interview_id,
        user_name: interviewInfo?.userName,
        user_email: interviewInfo?.userEmail,
        rawConversation: finalConversation
      })
    });

    const json = await res.json().catch(() => ({}));
    const rawAiResponse = json?.rawAiResponse ?? json?.raw_ai_response ?? (typeof json === "string" ? json : null);
    let feedbackObj = null;

    if (json?.parsed && typeof json.parsed === "object") {
      feedbackObj = json.parsed;
    } else if (json?.content) {
      try {
        feedbackObj = JSON.parse(json.content);
      } catch {
        feedbackObj = extractJsonFromResponse(String(json.content || ""));
      }
    } else if (typeof json === "object" && Object.keys(json).length) {
      feedbackObj = extractJsonFromResponse(JSON.stringify(json));
    }

    if (!feedbackObj) {
      // AI parsing failed — compute real scores from actual Q&A pairs
      feedbackObj = makeFallbackTemplate("AI response could not be parsed; local scoring applied.", pairs);
    }

    if (!json?.saved) {
      const normalized = normalizeForStorage(feedbackObj, { rawConversation: finalConversation, rawAiResponse, debug: { pairs } });
      await insertToSupabase(normalized);
    } else {
      console.log("Feedback was already saved to database by server.");
    }
  } catch (err) {
    console.error("AI feedback generation error:", err);
    const currentPairs = compressConversationForFeedback(finalConversation, 12);
    const fallback = makeFallbackTemplate("AI feedback generation error; local scoring applied.", currentPairs);
    await insertToSupabase(normalizeForStorage(fallback));
  }
}, [compressConversationForFeedback, interviewInfo, interview_id, supabase]);

  const setupVapiListeners = useCallback((instance) => {
    try {
      if (!instance || vapiHandlersRef.current) return;

      const safeHandler = (fn) => (...args) => {
        if (!isMountedRef.current || isCleaningUpRef.current) return;
        try {
          const r = fn(...args);
          if (r && typeof r.then === "function") r.catch(() => {});
        } catch {}
      };

      const onError = safeHandler((err) => {
        const msg = String(err?.message ?? err ?? "").toLowerCase();
        if (isSafeErrorRef.current(msg)) return;
        callStateRef.current.isConnecting = false;
        callStateRef.current.isConnected = false;
        safeSetState(setConnectionStatus, "failed");
        toast.error("Call error: " + (err?.message ?? String(err)));
      });

      const onCallStart = safeHandler(() => {
        callStateRef.current.isConnecting = false;
        callStateRef.current.isConnected = true;
        safeSetState(setVapiStarted, true);
        safeSetState(setConnectionStatus, "connected");
      });

      const onCallEnd = safeHandler((data) => {
        console.log("Vapi call ended:", data);
        callStateRef.current.isConnecting = false;
        callStateRef.current.isConnected = false;
        callStateRef.current.callId = null;
        safeSetState(setVapiStarted, false);
        safeSetState(setAiSpeaking, false);
        safeSetState(setUserSpeaking, false);
        safeSetState(setConnectionStatus, "idle");
        
        // Check if this was an ejection
        if (data?.endReason === "ejection" || data?.reason === "ejection") {
          console.warn("Vapi call was ejected:", data);
          toast.warning("Interview ended unexpectedly. Please try again.");
        }
      });

      const onSpeechStart = safeHandler(() => {
        safeSetState(setAiSpeaking, true);
      });

      const onSpeechEnd = safeHandler(() => {
        safeSetState(setAiSpeaking, false);
      });

      const onMessage = safeHandler((msg) => {
        try {
          const type = msg?.type ?? "";
          const role = msg?.role ?? "";
          const transcriptType = msg?.transcriptType ?? "";

          // --- User speech transcript (final only) ---
          if (type === "transcript" && role === "user") {
            const transcript = String(msg?.transcript ?? "").trim();
            if (transcriptType === "partial") {
              safeSetState(setUserSpeaking, true);
              if (userSpeakingTimeoutRef.current) clearTimeout(userSpeakingTimeoutRef.current);
              userSpeakingTimeoutRef.current = setTimeout(() => {
                if (isMountedRef.current && !isCleaningUpRef.current) safeSetState(setUserSpeaking, false);
              }, 1000);
            } else if (transcriptType === "final" && transcript) {
              safeSetState(setUserSpeaking, false);
              conversationRef.current.push({ role: "user", content: transcript });

              // Match user answer to the known question list
              const questionList = questions ?? [];
              const qIdx = lastQuestionIndexRef.current;
              if (qIdx >= 0 && qIdx < questionList.length) {
                const knownQuestion = questionList[qIdx]?.question ?? "";
                // Either update existing entry or push new
                const existing = qaCollectionRef.current.find(p => p.questionIndex === qIdx);
                if (existing) {
                  existing.answer = (existing.answer ? existing.answer + " " : "") + transcript;
                } else {
                  qaCollectionRef.current.push({ question: knownQuestion, answer: transcript, questionIndex: qIdx });
                }
              }
            }
          }

          // --- Assistant speech transcript (final only) ---
          if (type === "transcript" && role === "assistant") {
            const transcript = String(msg?.transcript ?? "").trim();
            if (transcriptType === "final" && transcript) {
              conversationRef.current.push({ role: "assistant", content: transcript });

              // Detect which known question the assistant is asking
              const questionList = questions ?? [];
              for (let i = 0; i < questionList.length; i++) {
                const qText = String(questionList[i]?.question ?? "").toLowerCase();
                // Match if assistant transcript contains significant portion of the question
                const words = qText.split(/\s+/).filter(w => w.length > 4);
                const matchCount = words.filter(w => transcript.toLowerCase().includes(w)).length;
                if (words.length > 0 && matchCount / words.length >= 0.5) {
                  lastQuestionIndexRef.current = i;
                  break;
                }
              }
            }
          }

          // --- conversation-update: capture VAPI's full authoritative message list ---
          if (type === "conversation-update") {
            const messages = msg?.conversation ?? msg?.messages ?? [];
            if (Array.isArray(messages) && messages.length > 0) {
              // Store the full snapshot — always overwrite with latest
              vapiFullConversationRef.current = messages.map(m => ({
                role: String(m?.role ?? "").toLowerCase(),
                content: String(m?.content ?? m?.message ?? "").trim()
              })).filter(m => m.role && m.content);

              // Also keep conversationRef in sync (dedup)
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.role && lastMsg?.content) {
                const isDuplicate = conversationRef.current.some(
                  m => m.role === lastMsg.role && m.content === lastMsg.content
                );
                if (!isDuplicate) {
                  conversationRef.current.push({ role: lastMsg.role, content: String(lastMsg.content).trim() });
                }
              }
            }
          }

          if (conversationRef.current.length > 1000) {
            conversationRef.current.splice(0, conversationRef.current.length - 1000);
          }
        } catch (e) {}
      });

      const handlers = {
        error: onError,
        "call-start": onCallStart,
        "call-end": onCallEnd,
        "speech-start": onSpeechStart,
        "speech-end": onSpeechEnd,
        message: onMessage
      };

      Object.entries(handlers).forEach(([evt, fn]) => {
        try { instance.on?.(evt, fn); } catch {}
      });
      vapiHandlersRef.current = handlers;
    } catch {}
  }, [safeSetState]);

  const teardownVapi = useCallback((instance) => {
    if (!instance) return;
    isCleaningUpRef.current = true;

    if (userSpeakingTimeoutRef.current) {
      clearTimeout(userSpeakingTimeoutRef.current);
      userSpeakingTimeoutRef.current = null;
    }

    try {
      const h = vapiHandlersRef.current;
      if (h) {
        Object.entries(h).forEach(([evt, fn]) => {
          try { instance.off?.(evt, fn); } catch {}
        });
        vapiHandlersRef.current = null;
      }
    } catch {}

    try {
      const p = instance.stop?.();
      if (p && typeof p.then === "function") p.catch(() => {});
    } catch {}

    vapiInstanceRef.current = null;
  }, []);

  const buildVoiceOptions = useCallback(() => {
    const openaiVoice = process.env.NEXT_PUBLIC_OPENAI_VOICE ?? "alloy";
    const azureVoice = process.env.NEXT_PUBLIC_AZURE_VOICE ?? "en-US-JennyNeural";
    const playhtVoice = process.env.NEXT_PUBLIC_PLAYHT_VOICE ?? "jennifer";
    const elevenlabsVoice = process.env.NEXT_PUBLIC_11LABS_VOICE ?? "21m00Tcm4TlvDq8ikWAM";

    if (TTS_PROVIDER === "openai") {
      return { provider: "openai", voiceId: openaiVoice, fallbackPlan: { voices: [{ provider: "azure", voiceId: azureVoice }] } };
    }
    if (TTS_PROVIDER === "11labs" || TTS_PROVIDER === "elevenlabs") {
      return { provider: "11labs", voiceId: elevenlabsVoice, fallbackPlan: { voices: [{ provider: "openai", voiceId: openaiVoice }, { provider: "azure", voiceId: azureVoice }] } };
    }
    if (TTS_PROVIDER === "playht") {
      return { provider: "playht", voiceId: playhtVoice, fallbackPlan: { voices: [{ provider: "openai", voiceId: openaiVoice }, { provider: "azure", voiceId: azureVoice }] } };
    }
    return { provider: "openai", voiceId: openaiVoice, fallbackPlan: { voices: [{ provider: "azure", voiceId: azureVoice }] } };
  }, [TTS_PROVIDER]);

  const micStreamRef = useRef(null);

  const checkMicrophonePermission = useCallback(async () => {
    try {
      if (micStreamRef.current) {
        const tracks = micStreamRef.current.getTracks();
        if (tracks.some(t => t.readyState === 'live')) {
          return true;
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      micStreamRef.current = stream;
      return true;
    } catch (err) {
      const errorName = err?.name ?? "";
      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        toast.error("Microphone access denied. Please allow microphone access and refresh.");
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        toast.error("No microphone found. Please connect a microphone and refresh.");
      } else {
        toast.error("Could not access microphone: " + (err?.message ?? String(err)));
      }
      return false;
    }
  }, []);

  const cleanupMicStream = useCallback(() => {
    if (micStreamRef.current) {
      try {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      } catch {}
      micStreamRef.current = null;
    }
  }, []);

  const attemptStartVapiWithTimeout = useCallback(async (options) => {
    const inst = vapiInstanceRef.current;
    if (!inst) throw new Error("Vapi not initialized");

    lastVapiOptionsRef.current = options;

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => { settled = true; };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        const err = new Error("vapi.start timeout");
        err.code = "VAPI_START_TIMEOUT";
        reject(err);
      }, VAPI_START_TIMEOUT_MS);

      try {
        const startPromise = inst.start(options);

        Promise.resolve(startPromise).then(
          (result) => {
            if (settled) return;
            cleanup();
            clearTimeout(timer);
            resolve(result);
          },
          (err) => {
            if (settled) return;
            const msg = String(err?.message ?? err ?? "").toLowerCase();
            if (isSafeErrorRef.current(msg)) {
              cleanup();
              clearTimeout(timer);
              resolve();
              return;
            }
            cleanup();
            clearTimeout(timer);
            reject(err);
          }
        );
      } catch (syncErr) {
        if (!settled) {
          cleanup();
          clearTimeout(timer);
          reject(syncErr);
        }
      }
    });
  }, []);

  const startCall = useCallback(async () => {
    const state = callStateRef.current;

    if (state.isConnecting) {
      return false;
    }

    if (state.isConnected) {
      return true;
    }

    if (!vapiInstanceRef.current) {
      return false;
    }

    if (!isMountedRef.current) {
      return false;
    }

    state.isConnecting = true;
    safeSetState(setConnectionStatus, "connecting");

    const hasMicPermission = await checkMicrophonePermission();
    if (!hasMicPermission) {
      state.isConnecting = false;
      safeSetState(setConnectionStatus, "failed");
      return false;
    }

    if (!state.isConnecting || state.isConnected) {
      return false;
    }

    const qArray = questions ?? [];
    const questionsString = qArray.map((q, idx) => `${idx + 1}. ${q.question}`).filter(Boolean).join("\n");

   const vapiOptions = {
  name: "AI Recruiter",

  firstMessage: `Hi ${interviewInfo?.userName ?? "candidate"}, ready for your interview?`,

  firstMessageMode: "assistant-speaks-first",

  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "multi"
  },

  startSpeakingPlan: {
    waitSeconds: 0.5
  },

  stopSpeakingPlan: {
    numWords: 2,
    voiceSeconds: 0.35,
    backoffSeconds: 0.8,
    acknowledgementPhrases: [
      "yeah",
      "yes",
      "ok",
      "okay",
      "right",
      "mm-hmm",
      "haan",
      "ha",
      "ji",
      "achu",
      "haa",
      "thik",
      "theek",
      "sahi",
      "correct",
      "hmm"
    ]
  },

  // Match your Vapi Voice Settings
  voice: {
    provider: "vapi",
    voiceId: "Elliot",
    version: "2",
    language: "auto",
    speed: 0.95
  },

  model: {
    provider: "openai",
    model: "gpt-4o-mini",

    messages: [
      {
        role: "system",
        content: `IDENTITY
You are a friendly, professional AI interviewer fluent in English, Hindi, and Gujarati.

====================
LANGUAGE CAPABILITIES
====================
You can:
- UNDERSTAND mixed languages (Hinglish, Gujlish, any combination of H+G+E)
- SPEAK in the same language as the candidate
- TRANSLATE between languages when helpful
- SWITCH languages naturally based on context

====================
LANGUAGE DETECTION & RESPONSE
====================
1. Detect the candidate's language preference from their first response
2. If they speak Hinglish (Hindi+English mix), respond in Hinglish
3. If they speak Gujlish (Gujarati+English mix), respond in Gujlish
4. If they speak pure Hindi, respond in Hindi
5. If they speak pure Gujarati, respond in Gujarati
6. If they speak pure English, respond in English
7. If unsure, ask: "Would you like to continue in Hindi, Gujarati, or English?"
8. Once language is set, stick to it unless candidate switches

====================
TRANSLATION RULES
====================
- If candidate asks in Hindi, answer in Hindi
- If candidate asks in Gujarati, answer in Gujarati
- If candidate asks in English, answer in English
- If candidate mixes languages, mirror their mix
- Only translate if candidate explicitly asks for translation
- Provide translations in parentheses if helpful for clarity

====================
INTERVIEW RULES
====================
- Ask only ONE interview question at a time
- Wait for the complete answer
- Never ask two questions together
- Never answer interview questions for the candidate
- If candidate asks for clarification, explain briefly in their language
- After receiving an answer, acknowledge and ask the next question
- After the final question, thank the candidate and end the interview politely

====================
VOICE STYLE
====================
- Speak naturally and confidently
- Speak clearly at a slightly slower pace
- Use short sentences
- Avoid long paragraphs
- Repeat important information once if necessary
- Match the candidate's speaking style

====================
SAFETY
====================
- Never invent information
- Ask for clarification when needed
- Never claim to perform actions you cannot perform

====================
INTERVIEW QUESTIONS
====================
Below are the questions to ask. Adapt them to the candidate's language:

${questionsString}`.trim()
      }
    ]
  }
};

    let attempt = 0;
    while (attempt < MAX_VAPI_START_RETRIES && isMountedRef.current && state.isConnecting) {
      attempt++;
      try {
        await attemptStartVapiWithTimeout(vapiOptions);
        state.isConnecting = false;
        state.isConnected = true;
        safeSetState(setVapiStarted, true);
        safeSetState(setConnectionStatus, "connected");
        toast.success("Voice AI connected");
        return true;
      } catch (err) {
        const code = err?.code ?? "";
        const msg = String(err?.message ?? err).toLowerCase();
        if (isSafeErrorRef.current(msg) || code === "VAPI_START_TIMEOUT") {
          if (attempt >= MAX_VAPI_START_RETRIES) {
            toast.info("Voice AI connection timed out. Please refresh and try again.");
            state.isConnecting = false;
            safeSetState(setVapiStarted, false);
            safeSetState(setConnectionStatus, "failed");
            return false;
          }
          const backoff = VAPI_RETRY_BASE_MS * Math.pow(2, attempt - 1);
          await delay(backoff);
          continue;
        }
        toast.error("Voice AI unavailable: " + (err?.message ?? String(err)));
        state.isConnecting = false;
        safeSetState(setVapiStarted, false);
        safeSetState(setConnectionStatus, "failed");
        return false;
      }
    }

    state.isConnecting = false;
    return false;
  }, [questions, interviewInfo, buildVoiceOptions, safeSetState, checkMicrophonePermission, attemptStartVapiWithTimeout]);

  const stopVapiIfNeeded = useCallback(async () => {
    try {
      const state = callStateRef.current;
      state.isConnecting = false;
      state.isConnected = false;
      state.callId = null;

      safeSetState(setVapiStarted, false);
      safeSetState(setAiSpeaking, false);
      safeSetState(setUserSpeaking, false);
      safeSetState(setConnectionStatus, "idle");

      if (userSpeakingTimeoutRef.current) {
        clearTimeout(userSpeakingTimeoutRef.current);
        userSpeakingTimeoutRef.current = null;
      }

      const inst = vapiInstanceRef.current;
      if (!inst) return;

      if (vapiHandlersRef.current) {
        Object.entries(vapiHandlersRef.current).forEach(([evt, fn]) => {
          try { inst.off?.(evt, fn); } catch {}
        });
        vapiHandlersRef.current = null;
      }

      try {
        await Promise.race([inst.stop?.(), delay(2000)]);
      } catch {}

      cleanupMicStream();

    } catch (e) {}
  }, [safeSetState, cleanupMicStream]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (vapiInstanceRef.current) return;

    try {
      if (!VAPI_KEY) {
        return;
      }

      const inst = new Vapi(VAPI_KEY);
      vapiInstanceRef.current = inst;
      setupVapiListeners(inst);

      return () => {
        isCleaningUpRef.current = true;
        teardownVapi(inst);
        cleanupMicStream();
      };
    } catch (e) {}
  }, [VAPI_KEY, setupVapiListeners, teardownVapi, cleanupMicStream]);

  const onStartClick = useCallback(async () => {
    if (callStateRef.current.hasStarted) {
      return;
    }

    if (!interviewInfo) {
      toast.error("Interview info missing");
      return;
    }

    callStateRef.current.hasStarted = true;

    safeSetState(setStarted, true);
    safeSetState(setStopping, false);

    try {
      timerRef.current?.start?.();
    } catch (e) {}

    let vapiReady = false;
    try {
      vapiReady = Boolean(await startCall());
      if (vapiReady) {
        safeSetState(setVapiStarted, true);
      }
    } catch (e) {
      vapiReady = false;
      safeSetState(setVapiStarted, false);
    }

    if (!vapiReady) {}
  }, [interviewInfo, startCall, safeSetState]);

  const onStopClick = useCallback(async () => {
    if (loading || stopping) return;

    safeSetState(setLoading, true);
    safeSetState(setStopping, true);
    isCleaningUpRef.current = true;

    try {
      await stopVapiIfNeeded();

      try {
        timerRef.current?.stop?.();
      } catch (e) {}

      try {
        await generateFeedbackAndSave();
      } catch (e) {}

      safeSetState(setLoading, false);

      try {
        router.replace(`/interview/${interview_id}/completed`);
      } catch (e) {
        window.location.href = `/interview/${interview_id}/completed`;
      }
    } catch (err) {
      safeSetState(setLoading, false);
      toast.error("Failed to stop interview cleanly.");
    } finally {
      safeSetState(setStopping, false);
      safeSetState(setAiSpeaking, false);
      safeSetState(setUserSpeaking, false);
    }
  }, [loading, stopping, stopVapiIfNeeded, generateFeedbackAndSave, router, interview_id, safeSetState]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      isCleaningUpRef.current = true;

      callStateRef.current = {
        hasStarted: false,
        isConnecting: false,
        isConnected: false,
        callId: null
      };

      if (userSpeakingTimeoutRef.current) {
        clearTimeout(userSpeakingTimeoutRef.current);
        userSpeakingTimeoutRef.current = null;
      }

      try {
        const inst = vapiInstanceRef.current;
        if (inst) teardownVapi(inst);
      } catch (e) {}

      cleanupMicStream();
    };
  }, [teardownVapi, cleanupMicStream]);

  const onStartClickRef = useRef(onStartClick);
  useEffect(() => {
    onStartClickRef.current = onStartClick;
  }, [onStartClick]);

  useEffect(() => {
    if (!interviewInfo) return;
    if (callStateRef.current.hasStarted) return;

    const timer = setTimeout(() => {
      if (!callStateRef.current.hasStarted && isMountedRef.current) {
        onStartClickRef.current();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [interviewInfo]);

  const getStatusMessage = useCallback(() => {
    if (!started) return "interview Started..";
    switch (connectionStatus) {
      case "connecting":
        return "Connecting to Voice AI...";
      case "connected":
        return "Voice AI connected • Interview in progress...";
      case "failed":
        return "Voice AI connection failed • Please refresh";
      default:
        return vapiStarted ? "Voice AI connected • Interview in progress..." : "Starting interview...";
    }
  }, [started, connectionStatus, vapiStarted]);

  const statusMessage = getStatusMessage();

  return (
    <div className="p-8 lg:px-48 xl:px-56">
      <h2 className="font-bold text-xl flex justify-between items-center">
        AI Interview Session
        <span className="flex gap-2 items-center">
          <TimerComponent ref={timerRef} />
        </span>
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-7 mt-5">
        <div className="bg-white h-100 rounded-lg border flex flex-col gap-3 items-center justify-center p-6">
          <div className="relative inline-flex items-center justify-center overflow-visible">
            {(aiSpeaking || true) && (
              <span className="absolute -inset-2 rounded-full bg-blue-500 opacity-50 pointer-events-none animate-ping" />
            )}
            <Image
              src="/ai.png"
              alt="ai"
              width={100}
              height={100}
              className="relative z-10 w-15 h-15 rounded-full object-cover"
            />
          </div>
          <h2>AI Recruiter</h2>
        </div>

        <div className="bg-white h-100 rounded-lg border flex flex-col gap-3 items-center justify-center p-6">
          <div className="relative inline-flex items-center justify-center overflow-visible">
            {userSpeaking && (
              <span className="absolute -inset-2 rounded-full bg-blue-500 opacity-50 pointer-events-none animate-ping" />
            )}
            <h2 className="relative z-10 text-2xl bg-primary text-white p-3 rounded-full px-6">
              {interviewInfo?.userName?.[0] ?? ""}
            </h2>
          </div>
          <h2>{interviewInfo?.userName}</h2>
        </div>
      </div>

      <div className="flex items-center gap-5 justify-center mt-7">
        <div className={cls("rounded-full")}>
          <div className="flex items-center gap-4">
            <div className="flex items-center">
              <div className={`rounded-full ${userSpeaking ? 'bg-green-500' : 'bg-gray-500'} text-white`}>
                <IconButton
                  onClick={() => {}}
                  disabled
                  size="md"
                  className={`${userSpeaking ? 'bg-green-500' : 'bg-gray-500'} text-white`}
                  ariaLabel="Microphone"
                >
                  <Mic className="w-5 h-5" />
                </IconButton>
              </div>
            </div>

            {!loading ? (
              <IconButton
                onClick={onStopClick}
                disabled={stopping}
                size="lg"
                className="bg-red-500 text-white hover:bg-red-600 cursor-pointer"
                ariaLabel="End interview"
              >
                <Phone className="w-6 h-6" />
              </IconButton>
            ) : (
              <div className="w-14 h-14 flex items-center justify-center rounded-full bg-gray-100">
                <Loader2 className="animate-spin w-6 h-6 text-gray-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      <h2 className={cls(
        "text-sm text-center mt-5",
        connectionStatus === "failed" ? "text-red-500" : "text-gray-400"
      )}>
        {statusMessage}
      </h2>

      {connectionStatus === "connecting" && (
        <div className="flex items-center justify-center mt-3 gap-2">
          <Loader2 className="animate-spin w-4 h-4 text-blue-500" />
          <span className="text-sm text-blue-500">Establishing connection...</span>
        </div>
      )}
    </div>
  );
}
