import React from 'react';
import type { Question, UserAnswer } from './types';
import QuestionSelect from './QuestionSelect';
import QuestionMultiSelect from './QuestionMultiSelect';
import QuestionMatch from './QuestionMatch';
import QuestionClassify from './QuestionClassify';

interface QuestionRendererProps {
  question: Question;
  userAnswer?: UserAnswer;
  showFeedback: boolean;
  onAnswer: (answer: UserAnswer) => void;
}

export default function QuestionRenderer({ question, userAnswer, showFeedback, onAnswer }: QuestionRendererProps) {
  switch (question.type) {
    case 'select':
      return <QuestionSelect question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
    case 'multiselect':
      return <QuestionMultiSelect question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
    case 'match':
      return <QuestionMatch question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
    case 'classify':
      return <QuestionClassify question={question} userAnswer={userAnswer} showFeedback={showFeedback} onAnswer={onAnswer} />;
  }
}
