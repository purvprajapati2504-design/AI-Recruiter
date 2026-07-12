"use client";

import React, { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

function safeParse(obj) {
  if (typeof obj === "string") {
    try {
      return JSON.parse(obj);
    } catch {
      return obj;
    }
  }
  return obj || {};
}

function getJobPosition(interview) {
  if (!interview) return null;
  if (typeof interview === "string") {
    try {
      interview = JSON.parse(interview);
    } catch {
      return null;
    }
  }
  return interview.jobposition || interview.jobPosition || interview.position || null;
}

export default function CandidateFeedbackDialog({candidate = {}}) {
  let parsedFeedback = {};
  try {
    parsedFeedback =
      typeof candidate.feedback === "string"
        ? JSON.parse(candidate.feedback)
        : candidate.feedback || {};
  } catch (err) {
    parsedFeedback = {};
  }

  const feedback = parsedFeedback?.feedback || {};
  const rating = feedback?.rating || {};
  const ratingKeys = [
    "technicalSkills",
    "communication",
    "problemSolving",
    "experience",
    "confidence",
    "overall",
  ];

  const averageRating = useMemo(() => {
    const total = ratingKeys.reduce((s, k) => s + (Number(rating[k]) || 0), 0);
    return ratingKeys.length ? Math.round(total / ratingKeys.length) : 0;
  }, [rating]);

  const formatLabel = (key) =>
    key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());

  const buildEmailBody = () => {
    const lines = [];
    lines.push(`Hello Hiring Team,`);
    lines.push("");
    lines.push(
      `Please find the interview feedback for ${candidate?.user_name || "the candidate"} below.`
    );
    lines.push("");
    lines.push(`Candidate: ${candidate?.user_name || "Unknown"}`);
    lines.push(`Email: ${candidate?.user_email || "N/A"}`);
    lines.push("");
    lines.push(`Ratings:`);
    ratingKeys.forEach((k) => {
      lines.push(`• ${formatLabel(k)}: ${rating[k] ?? 0}/10`);
    });
    lines.push(`• Average Rating: ${averageRating}/10`);
    lines.push("");
    lines.push(`Performance Summary:`);
    lines.push(feedback?.summary || "No summary available.");
    lines.push("");
    lines.push(`Recommendation:`);
    lines.push(
      `${feedback?.recommendation === false ? "Not recommended" : "Recommended"}${
        feedback?.recommendationMsg ? ` — ${feedback.recommendationMsg}` : ""
      }`
    );
    lines.push("");
    lines.push("");
    lines.push(`Best regards,`);
    lines.push(`${candidate?.user_name || "the candidate"}`);
    return lines.join("\n");
  };

  const openGmailCompose = () => {
    const to = "dnsptl2004@gmail.com";
    const subject = `Feedback: ${candidate?.user_name || "Candidate"} — Interview Summary`;
    const body = buildEmailBody();

    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      to,
      su: subject,
      body,
    });

    const url = `https://mail.google.com/mail/?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-primary">
          View Report
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Feedback</DialogTitle>
          <DialogDescription asChild>
            <div className="mt-5 space-y-6">
              <div className="flex items-center gap-5">
                <div className="h-14 w-14 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg">
                  {candidate?.user_name?.[0] || "?"}
                </div>
                <div>
                  <div className="text-lg font-semibold">
                    {candidate?.user_name || "Unknown"}
                  </div>
                  <div className="text-sm text-gray-500">
                    {candidate?.user_email || "N/A"}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-sm text-gray-500">Average Rating</div>
                  <div className="text-xl font-bold">{averageRating}/10</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-primary">Skills Assessment</div>
                    <div className="text-sm text-gray-500">Detailed ratings</div>
                  </div>

                  <div className="space-y-4">
                    {ratingKeys.map((key) => {
                      const val = Number(rating[key]) || 0;
                      return (
                        <div key={key} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <div className="font-medium">{formatLabel(key)}</div>
                            <div className="text-sm text-gray-600">{val}/10</div>
                          </div>
                          <Progress
                            value={Math.min(Math.max(val * 10, 0), 100)}
                            className="h-2 rounded"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="font-semibold text-primary">Performance Summary</div>
                  <div className="p-4 bg-secondary rounded-md">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {feedback?.summary || "No summary available."}
                    </p>
                  </div>

                  <div
                    className={`p-4 rounded-md ${
                      feedback?.recommendation === false ? "bg-red-50" : "bg-green-50"
                    }`}
                  >
                    <div
                      className={`font-semibold ${
                        feedback?.recommendation === false ? "text-red-700" : "text-green-700"
                      }`}
                    >
                      {feedback?.recommendation === false ? "Not recommended" : "Recommended"}
                    </div>
                    <div className="text-sm text-gray-700 mt-2">
                      {feedback?.recommendationMsg || "No recommendation message."}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <Button
                  onClick={openGmailCompose}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Send Full Report via Gmail
                </Button>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
