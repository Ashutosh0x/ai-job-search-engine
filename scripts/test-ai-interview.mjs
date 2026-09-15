import {
  createFallbackEvaluation,
  createFallbackNextTurn,
  createFallbackPlan,
} from '../lib/ai-interview/interviewer.ts'
import { canTransitionInterviewState } from '../lib/ai-interview/types.ts'

let passed = 0
let failed = 0
const check = (name, condition, actual = '') => {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${actual ? `: ${JSON.stringify(actual)}` : ''}`)
  }
}

const context = {
  jobId: 'ashby:acme:123',
  jobTitle: 'Senior Backend Engineer',
  companyName: 'Acme',
  description: 'Design reliable Python services on AWS with PostgreSQL.',
  skills: ['Python', 'Distributed systems', 'AWS', 'PostgreSQL'],
  interviewType: 'technical',
  durationMinutes: 20,
  candidate: { profileSummary: '', skills: [], resumeText: '' },
}

console.log('\nAI interview plan')
const plan = createFallbackPlan(context)
check('20 minute session has an eight-question target', plan.questionsTarget === 8, plan.questionsTarget)
check('plan remains grounded in job skills', plan.topicsRemaining.includes('Python'), plan.topicsRemaining)
check('opening question names an actual requirement', plan.openingQuestion.includes('Python'), plan.openingQuestion)

console.log('\nAdaptive fallback turn')
const next = createFallbackNextTurn({
  context,
  plan,
  turns: [
    { sequence: 1, speaker: 'interviewer', transcript: plan.openingQuestion, skills: ['Python'] },
    { sequence: 2, speaker: 'candidate', transcript: 'I used PostgreSQL to make a billing service more reliable.', skills: [] },
  ],
  answer: 'I used PostgreSQL to make a billing service more reliable.',
})
check('first follow-up uses an answer-derived subject', next.question.includes('PostgreSQL'), next.question)
check('turn stays one question', (next.question.match(/\?/g) || []).length === 1, next.question)

console.log('\nEvidence-based evaluation')
const evaluation = createFallbackEvaluation({
  context,
  plan,
  turns: [
    { sequence: 1, speaker: 'interviewer', transcript: plan.openingQuestion, skills: ['Python'] },
    { sequence: 2, speaker: 'candidate', transcript: 'I built Python APIs on AWS and tuned PostgreSQL after measuring slow queries.', skills: [] },
  ],
})
const python = evaluation.requirementAssessments.find((item) => item.skill === 'Python')
const distributed = evaluation.requirementAssessments.find((item) => item.skill === 'Distributed systems')
check('directly discussed requirement has strong evidence', python?.level === 'strong', python)
check('missing job requirement is called out for practice', distributed?.level === 'needs-practice', distributed)
check('assessment is explicitly not a hiring prediction', evaluation.disclaimer.includes('not a prediction'), evaluation.disclaimer)

console.log('\nInterview state machine')
check('speaking can be interrupted', canTransitionInterviewState('speaking', 'interrupted'))
check('interruption returns to listening', canTransitionInterviewState('interrupted', 'listening'))
check('idle cannot jump straight to completed', !canTransitionInterviewState('idle', 'completed'))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
