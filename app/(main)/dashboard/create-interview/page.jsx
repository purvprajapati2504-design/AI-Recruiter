"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { Progress } from "@/components/ui/progress";
import FormContainer from "./_components/FormContainer";
import QuestionList from "./_components/QuestionList";
import { toast } from "sonner";
import InterviewLink from "./_components/InterviewLink";
import { useUser } from "@/app/provider";

function CreateInterview() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formdata, setFormData] = useState();
  const { user } = useUser();
  const [interviewId, setInterviewId] = useState(); 

  const onHandleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const onGoToNext = () => {
    if (user?.credits <= 0) {
      toast("Please add credits");
      return;
    }
    if (
      !formdata?.jobPosition ||
      !formdata?.jobDescription ||
      !formdata?.duration ||
      !formdata?.type
    ) {
      toast("Please enter all details");
      return;
    }
    if (!formdata?.resume) {
      toast("Please upload your resume");
      return;
    }
    setStep(step + 1);
  };

  const onCreateLink = (interview_id) => {
    setInterviewId(interview_id); 
    setStep(step + 1);
  };

  return (
    <div className="mt-10 px-10 md:px-24 lg:px-44 xl:px-56">
      <div className="flex gap-5 items-center">
        <ArrowLeft
          onClick={() => router.back()}
          className="cursor-pointer"
        />
        <h2 className="font-bold text-2xl">Create New Interview</h2>
      </div>

      <Progress value={step * 33.33} className="my-5" />

      {step == 1 ? (
        <FormContainer
          onHandleInputChange={onHandleInputChange}
          GoToNext={() => onGoToNext()}
        />
      ) : step == 2 ? (
        <QuestionList
          formdata={formdata}
          onCreateLink={(interview_id) => onCreateLink(interview_id)}
        />
      ) : step == 3 ? (
        <InterviewLink interview_id={interviewId} formdata={formdata} />
      ) : null}
    </div>
  );
}

export default CreateInterview;
