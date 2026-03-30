export type QuestionType = 'select' | 'multiselect' | 'match' | 'classify';
export type PointsType = 'over100' | 'over10' | 'over5' | 'percent';
export type OnTimeUp = 'submit' | 'warn';

export interface Question {
  id: string;
  title: string;
  type: QuestionType;
  points: number;
  explanation: string;
  answers?: string[];
  correctAnswer?: number | number[];
  matchPairs?: { left: string; right: string }[];
  categories?: string[];
  classifyItems?: { text: string; category: string }[];
}

export interface TestConfig {
  id: string;
  title: string;
  questions: Question[];
  numberOfQuestions: number;
  time: number;
  pointsType: PointsType;
  minForPass: number;
  onTimeUp: OnTimeUp;
}

export interface UserAnswer {
  questionId: string;
  answeredAt: string;
  timeSpentMs: number;
  selectedIndices?: number[];
  matchedPairs?: { left: string; right: string }[];
  classifiedItems?: { text: string; category: string }[];
}

export interface TestSession {
  testId: string;
  selectedQuestionIds: string[];
  currentQuestionIndex: number;
  answers: Record<string, UserAnswer>;
  timeRemainingMs: number;
  startedAt: string;
  status: 'in-progress' | 'completed';
}

export interface QuestionResult {
  questionId: string;
  correct: boolean;
  pointsEarned: number;
  pointsPossible: number;
  timeSpentMs: number;
  userAnswer: UserAnswer;
}

export interface TestResult {
  testId: string;
  completedAt: string;
  score: number;
  maxScore: number;
  passed: boolean;
  totalTimeMs: number;
  questionResults: QuestionResult[];
}

export interface ModuleTestEntry {
  id: string;
  title: string;
  config: TestConfig;
}
