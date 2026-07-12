import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function fetchWithTimeout(url, options = {}, ms = 120000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function safeText(v) {
  return String(v ?? "").trim();
}


function tryParseJSONLoose(raw) {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(trimmed.slice(firstArr, lastArr + 1));
    } catch {}
  }

  const firstObj = trimmed.indexOf("{");
  const lastObj = trimmed.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(trimmed.slice(firstObj, lastObj + 1));
    } catch {}
  }

  return null;
}

function normalizeQuestions(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data?.questions)
      ? data.questions
      : [];

  return source
    .map((item) => {
      if (typeof item === "string") {
        const q = item.trim();
        return q ? { question: q, type: "Technical" } : null;
      }

      if (item && typeof item === "object") {
        const question = safeText(
          item.question ?? item.text ?? item.q ?? item.prompt
        );
        if (!question) return null;

        return {
          question,
          type: safeText(item.type) || "Technical",
        };
      }

      return null;
    })
    .filter(Boolean);
}

function extractAssistantText(rawText) {
  const parsed = tryParseJSONLoose(rawText);

  const content =
    parsed?.choices?.[0]?.message?.content ??
    parsed?.choices?.[0]?.text ??
    parsed?.choices?.[0]?.message?.reasoning ??
    "";

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  return safeText(rawText);
}

async function callOpenRouter(model, payload, apiKey, timeoutMs = 120000) {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  return await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME || "Interview Generator",
      },
      body: JSON.stringify({ ...payload, model }),
    },
    timeoutMs
  );
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { jobPosition, jobDescription, duration = "30", type = "technical" } =
      body || {};

    if (!jobPosition || !jobDescription) {
      return NextResponse.json(
        { error: "Missing jobPosition or jobDescription" },
        { status: 400 }
      );
    }

    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim();
    const model = process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-flash";

    if (!OPENROUTER_KEY) {
      return NextResponse.json(
        { error: "OpenRouter API key is missing. Please set OPENROUTER_API_KEY." },
        { status: 400 }
      );
    }

    const salt = Math.random().toString(36).substring(7);
    const prompt = `
Return ONLY valid JSON:
{
  "questions": [
    { "question": "string", "type": "Technical" }
  ]
}

Generate an appropriate number of questions based on a duration of ${duration} minutes for a ${type} interview.
Role: ${jobPosition}
Job description: ${jobDescription}

Rules:
- The number of questions must scale proportionally with the interview duration of ${duration} minutes (approx. 1 question per 3 to 5 minutes of interview time. For example, 10 mins = 2-3 questions, 30 mins = 6-10 questions, 60 mins = 12-15 questions).
- There is no arbitrary cap (like 3 to 5). Generate as many as needed to fill the duration.
- question must be a single interview question
- type must be one of: Technical, Behavioral, Problem Solving, Experience
- Every question must be uniquely tweaked, highly specific to the job description, and creative. Avoid repeating the same questions across generations.
- Seed value (for variety): ${salt}
- no markdown
- no explanation
- no extra keys
`.trim();

    const payload = {
      messages: [
        {
          role: "system",
          content: "You generate interview questions and output only JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 1500,
    };

    const resp = await callOpenRouter(model, payload, OPENROUTER_KEY, 120000);
    const rawText = await resp.text().catch(() => "");
    const parsed = tryParseJSONLoose(rawText);

    if (!resp.ok) {
      console.error("OpenRouter error:", resp.status, rawText);
      return NextResponse.json(
        {
          error: "OpenRouter service error",
          upstreamError: rawText || `OpenRouter error ${resp.status}`,
        },
        { status: resp.status || 502 }
      );
    }

    const assistantText = extractAssistantText(rawText);
    const jsonCandidate = tryParseJSONLoose(assistantText) ?? tryParseJSONLoose(rawText);
    const questions = normalizeQuestions(jsonCandidate);

    if (!questions.length) {
      console.error("No valid questions parsed:", assistantText);
      return NextResponse.json(
        {
          error: "AI returned invalid question format",
          upstreamError: assistantText || "No readable content",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ questions }, { status: 200 });
  } catch (err) {
    console.error("ai-model route failed:", err);
    return NextResponse.json(
      {
        error: err?.message || "AI service failed",
      },
      { status: 500 }
    );
  }
}