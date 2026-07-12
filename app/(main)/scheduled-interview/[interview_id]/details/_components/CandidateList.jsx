"use client";
import { Button } from '@/components/ui/button';
import moment from 'moment';
import React from 'react';
import CandidateFeedbackDialog from "./CandidateFeedbackDialog";

function CandidateList({ candidateList = [] }) {
  return (
    <div>
      <h2 className='font-bold my-5'>Candidates ({candidateList.length})</h2>

      {candidateList.map((candidate, index) => {
        let parsedFeedback = {};
        try {
          parsedFeedback = typeof candidate.feedback === "string" ? JSON.parse(candidate.feedback) : candidate.feedback || {};
        } catch { parsedFeedback = {}; }

        const rating = parsedFeedback?.feedback?.rating || {};
        const averageRating = Math.round(
          ((rating.technicalSkills || 0) + (rating.communication || 0) + (rating.problemSolving || 0) + (rating.experience || 0) + (rating.confidence || 0) + (rating.overall || 0)) / 6
        );

        return (
          <div key={index} className="p-5 flex gap-3 items-center justify-between bg-white rounded-lg">
            <div className='flex items-center gap-5'>
              <h2 className='bg-primary p-3 px-4.5 font-bold text-white rounded-full'>{candidate?.user_name?.[0] || "?"}</h2>
              <div>
                <h2 className='font-bold'>{candidate?.user_name || "Unknown"}</h2>
                <h2 className='text-sm text-gray-500'>
                  Completed On: {candidate?.created_at ? moment(candidate.created_at).format('MMM DD, yyyy') : "N/A"}
                </h2>
              </div>
            </div>

            <div className='flex gap-3 items-center'>
              <h2 className='text-green-600'>{averageRating}/10</h2>
              <CandidateFeedbackDialog candidate={candidate} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CandidateList;
