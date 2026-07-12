"use client";

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import React, { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { InterviewType } from '@/lib/services/Constants'
import { ArrowRight, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

function FormContainer({ onHandleInputChange, GoToNext }) {

  const [interviewType, setInterviewType] = useState([]);
  const [resumeFile, setResumeFile] = useState(null);

  useEffect(() => {
    if (interviewType.length) {
      onHandleInputChange("type", interviewType);
    }
  }, [interviewType]);

  const AddInterviewType = (type) => {
    const data = interviewType.includes(type);
    if (!data) {
      setInterviewType(prev => [...prev, type]);
    } else {
      const result = interviewType.filter(item => item != type);
      setInterviewType(result);
    }
  };

  const handleResumeUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setResumeFile(file);
      onHandleInputChange('resume', file);
    }
  };

  return (
    <div className='p-5 bg-white rounded-xl'>
      <div>
        <h2 className='text-sm font-medium'>Job Position</h2>
        <Input
          placeholder="e.g. Full Stack Developer"
          className='mt-2'
          onChange={(event) =>
            onHandleInputChange('jobPosition', event.target.value)
          }
        />
      </div>

      <div className='mt-5'>
        <h2 className='text-sm font-medium'>Job Description</h2>
        <Textarea
          placeholder='Enter details job descripition'
          className='h-50 mt-2'
          onChange={(event) =>
            onHandleInputChange('jobDescription', event.target.value)
          }
        />
      </div>

      <div className='mt-5'>
        <h2 className='text-sm font-medium'>interview Duration</h2>
        <Select onValueChange={(value) => onHandleInputChange('duration', value)}>
          <SelectTrigger className="w-full mt-2">
            <SelectValue placeholder="Select Duration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5 Min">5 Min</SelectItem>
            <SelectItem value="15 Min">15 Min</SelectItem>
            <SelectItem value="30 Min">30 Min</SelectItem>
            <SelectItem value="45 Min">45 Min</SelectItem>
            <SelectItem value="60 min">60 Min</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-5">
        <h2 className="text-sm font-medium">Interview Type</h2>

        <div className='flex gap-3 flex-wrap mt-2'>
          {InterviewType.map((type, index) => (
            <div
              key={index}
              className={`flex items-center cursor-pointer gap-2 p-1 px-2 bg-white border border-gray-300 rounded-2xl
              hover:bg-secondary ${interviewType.includes(type.title) && 'bg-blue-100 text-primary'}`}
              onClick={() => AddInterviewType(type.title)}
            >
              <type.icon className='h-4 w-4' />
              <span>{type.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className='mt-5'>
        <h2 className='text-sm font-medium'>Resume <span className='text-red-500'>*</span></h2>
        <div className='mt-2'>
          <Input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={handleResumeUpload}
            className="cursor-pointer"
            required
          />
          {resumeFile && (
            <p className='text-xs text-gray-500 mt-1'>
              Selected: {resumeFile.name}
            </p>
          )}
        </div>
      </div>

      <div className='mt-7 flex justify-end cursor-pointer' onClick={() => GoToNext()}>
        <Button>Generate Question<ArrowRight /></Button>
      </div>
    </div>
  );
}

export default FormContainer;
