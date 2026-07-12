"use client";

import { Button } from "@/components/ui/button";
import axios from "axios";
import { Loader2Icon } from "lucide-react";
import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useUser } from "@/app/provider";
import { v4 as uuidv4 } from "uuid";

function isLikelyQuestion(s) {
  if (!s || typeof s !== "string") return false;
  if (/\?/.test(s)) return true;

  const lower = s.trim().toLowerCase();
  const starters = [
    "what",
    "how",
    "why",
    "when",
    "where",
    "who",
    "which",
    "explain",
    "describe",
    "list",
    "give",
    "provide",
    "name",
  ];

  return starters.some((st) => lower.startsWith(st)) && s.split(" ").length > 3;
}

function tryParseJsonArrayFromText(text) {
  if (!text || typeof text !== "string") return null;

  const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    try {
      return JSON.parse(jsonArrayMatch[0]);
    } catch {}
  }

  return null;
}

function extractQuestions(text) {
  if (!text || typeof text !== "string") return [];
  const trimmed = text.trim();

  const parsedArray = tryParseJsonArrayFromText(trimmed);
  if (Array.isArray(parsedArray) && parsedArray.length) {
    const candidates = [];
    parsedArray.forEach((item) => {
      if (typeof item === "string") candidates.push(item);
      if (typeof item === "object" && item !== null) {
        ["question", "text", "q", "prompt", "title"].forEach((k) => {
          if (item[k]) candidates.push(String(item[k]));
        });
      }
    });

    const normalized = Array.from(
      new Set(
        candidates
          .map((c) => String(c).trim())
          .filter(Boolean)
          .filter(isLikelyQuestion)
      )
    );
    if (normalized.length) return normalized;
  }

  let cleaned = trimmed.replace(/```[\s\S]*?```/g, "").replace(/\r/g, "\n").trim();
  cleaned = cleaned.replace(/```json|```/gi, "").trim();

  const normalize = (line) =>
    line
      .replace(/^\s*\d+[\).\s-]*/, "")
      .replace(/^[-*•]\s*/, "")
      .replace(/["{}]/g, "")
      .replace(/\b(question|q)[:\s-]*/gi, "")
      .replace(/^\s*not\s+write\s+question[:\s-]*/i, "")
      .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const candidates = [];

    const collect = (obj) => {
      if (!obj) return;

      if (typeof obj === "string") {
        candidates.push(obj.trim());
        return;
      }

      if (Array.isArray(obj)) {
        obj.forEach(collect);
        return;
      }

      if (typeof obj === "object") {
        ["question", "text", "q", "prompt", "title"].forEach((k) => {
          if (obj[k]) collect(obj[k]);
        });

        Object.values(obj).forEach((v) => {
          if (typeof v === "string") collect(v);
          if (Array.isArray(v)) v.forEach(collect);
          if (typeof v === "object" && v !== null) collect(v);
        });
      }
    };

    collect(parsed);

    const filtered = Array.from(
      new Set(
        candidates
          .map(normalize)
          .map((c) => c.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .filter(isLikelyQuestion)
      )
    );

    if (filtered.length) return filtered;
  } catch {}

  const blocks = cleaned.split(/\n{1,}/).flatMap((p) => p.split(/\n/));
  const candidates = blocks
    .map(normalize)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^(type|duration|job|position|category|difficulty)[:\s]/i.test(line))
    .filter(isLikelyQuestion);

  return Array.from(new Set(candidates));
}

function QuestionListContainer({ questionList }) {
  if (!Array.isArray(questionList) || questionList.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        No questions to display
      </div>
    );
  }

  return (
     <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
     <div className="flex items-start justify-between gap-4"> 
      <div className="flex items-center gap-4"> 
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-linear-to-br from-blue-600 to-indigo-600 text-white text-lg font-semibold"> Q </div>
         <div> 
          <h3 className="text-lg font-semibold text-slate-900">Generated Interview Questions</h3>
           <p className="mt-1 text-sm text-slate-500"> Questions have been generated and are ready for Interview. </p> 
           </div> 
           </div> 
           </div>
            <div className="mt-5"> 
              <div className="rounded-md border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"> Questions have been generated. Click On Create Interview Link For Interview </div> 
              </div>
               </div> 
               );
               }
               
export default function QuestionList({ formdata, onCreateLink }) {
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [questionList, setQuestionList] = useState([]);

  const generateQuestions = useCallback(async () => {
    const jobPosition = formdata?.jobPosition ?? "";
    const jobDescription = formdata?.jobDescription ?? "";
    const duration = formdata?.duration ?? "30";
    const type = formdata?.type ?? "technical";

    if (!jobPosition || !jobDescription) {
      setQuestionList([]);
      return;
    }

    setLoading(true);
    setQuestionList([]);

    try {
      const payload = {
        jobPosition,
        jobDescription,
        duration,
        type,
      };

      const res = await axios.post("/api/ai-model", payload, { timeout: 120000 });

      const questionsFromApi = Array.isArray(res.data?.questions) ? res.data.questions : [];
      const extractedFromContent = extractQuestions(String(res.data?.content ?? ""));

      const finalQuestions =
        questionsFromApi.length > 0
          ? questionsFromApi
              .map((q) => {
                if (typeof q === "string") return q.trim();
                if (q && typeof q === "object") return String(q.question ?? q.text ?? "").trim();
                return "";
              })
              .filter(Boolean)
          : extractedFromContent;

      if (finalQuestions.length === 0) {
        const content = String(res.data?.content ?? "");
        if (/provide the job description|please provide the job description|need the job description/i.test(content)) {
          toast("Please add a detailed job description and try again");
        } else {
          console.error("No questions extracted. AI content:", content);
          toast("AI returned no questions. Check console for AI content.");
        }
        setQuestionList([]);
        return;
      }

      setQuestionList(finalQuestions);
    } catch (error) {
      console.error("generateQuestions error:", error);
      const serverMsg = error?.response?.data?.error || error?.message || "AI service failed";

      const upstream = error?.response?.data?.upstream;
      if (upstream) {
        try {
          const parsed = typeof upstream === "string" ? JSON.parse(upstream) : upstream;
          console.error("Upstream body (parsed):", parsed);
        } catch {
          console.error("Upstream body (truncated):", String(upstream).slice(0, 2000));
        }
      }

      toast(serverMsg);
      setQuestionList([]);
    } finally {
      setLoading(false);
    }
  }, [formdata?.jobPosition, formdata?.jobDescription, formdata?.duration, formdata?.type]);

  useEffect(() => {
    if (formdata?.jobPosition && formdata?.jobDescription) {
      generateQuestions();
    }
  }, [formdata?.jobPosition, formdata?.jobDescription, generateQuestions]);

  async function onFinish() {
    if (!user?.email) {
      toast("User not logged in");
      return;
    }

    if (questionList.length === 0) {
      toast("No questions to save");
      return;
    }

    if (!formdata?.resume) {
      toast("Resume is required");
      return;
    }

    setSaving(true);
    const interview_id = uuidv4();

    try {
      let resumeUrl = null;

      // Upload resume to Supabase Storage if provided
      if (formdata?.resume instanceof File) {
        try {
          const { supabase } = await import("@/lib/services/supabaseClient");
          const fileName = `${user.id}/${interview_id}/${formdata.resume.name}`;
          console.log("Uploading resume to:", fileName);
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('resumes')
            .upload(fileName, formdata.resume);

          console.log("Resume upload result:", { uploadData, uploadError });

          if (uploadError) {
            console.error("Resume upload error:", uploadError);
            toast("Failed to upload resume: " + uploadError.message);
            setSaving(false);
            return;
          } else {
            const { data: { publicUrl } } = supabase.storage
              .from('resumes')
              .getPublicUrl(fileName);
            resumeUrl = publicUrl;
            console.log("Resume public URL:", resumeUrl);
          }
        } catch (uploadErr) {
          console.error("Resume upload exception:", uploadErr);
          toast("Failed to upload resume: " + uploadErr.message);
          setSaving(false);
          return;
        }
      } else {
        toast("Resume file is required");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/create-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobposition: formdata?.jobPosition ?? "",
          jobdescription: formdata?.jobDescription ?? "",
          duration: formdata?.duration ?? "",
          type: formdata?.type ?? "",
          questionlist: questionList,
          useremail: user.email,
          interview_id,
          resume: resumeUrl,
        }),
      });

      const text = await res.text().catch(() => "");
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }

      console.log("API Response status:", res.status);
      console.log("API Response text:", text);
      console.log("API Response payload:", payload);

      if (!res.ok) {
        const serverMsg = payload?.error || payload?.message || "Create interview failed";
        toast(serverMsg);
        console.error("create-interview failed:", payload);
        return;
      }

      const saved = payload?.data ?? payload;
      const savedInterviewId = saved?.interview_id ?? interview_id;
      onCreateLink(savedInterviewId);
    } catch (err) {
      console.error(err);
      toast("Failed to create interview");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {loading && (
        <div className="flex items-center gap-4 rounded-xl border bg-blue-50 p-4">
          <Loader2Icon className="animate-spin" />
          <div>
            <p className="font-medium">Generating interview questions</p>
            <p className="text-sm text-slate-600">Please wait while AI prepares questions</p>
          </div>
        </div>
      )}

      {!loading && questionList.length > 0 && (
        <QuestionListContainer questionList={questionList} />
      )}

      {!loading && questionList.length === 0 && (
        <p className="text-sm text-slate-500">No questions generated yet</p>
      )}

      <div className="flex justify-end">
        <Button onClick={onFinish} disabled={saving}>
          {saving && <Loader2Icon className="mr-2 animate-spin" />}
          Create Interview Link
        </Button>
      </div>
    </div>
  );
}