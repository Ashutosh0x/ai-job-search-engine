"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import {
  AudioLines,
  FileText,
  Mic,
  MicOff,
  PhoneOff,
  Sparkles,
  Volume2,
} from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { getSupabaseClient } from "@/lib/supabase"
import type { InterviewEvaluation, InterviewVisualState } from "@/lib/ai-interview/types"
import styles from "./ai-interview-room.module.css"

export type { InterviewVisualState } from "@/lib/ai-interview/types"

export interface AIInterviewContext {
  jobId?: string
  jobTitle: string
  companyName: string
  skills: string[]
  interviewType?: "technical" | "behavioral" | "role-specific" | "mixed"
}

type InterviewTurn = {
  id: string
  speaker: "interviewer" | "candidate"
  text: string
}

type BrowserRecognitionEvent = {
  results: ArrayLike<{
    isFinal: boolean
    [index: number]: { transcript: string }
  }>
}

interface BrowserRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: BrowserRecognitionEvent) => void) | null
}

type BrowserRecognitionConstructor = new () => BrowserRecognition

declare global {
  interface Window {
    SpeechRecognition?: BrowserRecognitionConstructor
    webkitSpeechRecognition?: BrowserRecognitionConstructor
    webkitAudioContext?: typeof AudioContext
  }
}

const TARGET_QUESTIONS = 8
const DURATION_SECONDS = 20 * 60

function openingQuestion(context: AIInterviewContext) {
  const focus = context.skills[0] ?? "the work this role needs"
  return `Hello! I’m your AI interviewer. I’ll be interviewing you for the ${context.jobTitle} role at ${context.companyName}. To begin, tell me about a project where you used ${focus}. What made it challenging?`
}

function followUpQuestion(context: AIInterviewContext, questionNumber: number, answer: string) {
  const skill = context.skills[(questionNumber - 1) % Math.max(context.skills.length, 1)] ?? "this role"
  const words = answer
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4)
  const subject = words.find((word) => !["about", "would", "could", "there", "their", "which"].includes(word.toLowerCase()))

  if (questionNumber === 2 && subject) {
    return `You mentioned ${subject}. How did you decide what success looked like, and how did you measure it?`
  }
  if (questionNumber === 3) {
    return `Let’s go a little deeper on ${skill}. Tell me about a trade-off you had to make and how you reached that decision.`
  }
  if (questionNumber === 4) {
    return `Imagine a critical issue appears in production. How would you investigate it, communicate with the team, and decide what to do first?`
  }
  if (questionNumber === 5) {
    return `What is a piece of feedback that changed how you work? Walk me through what you did with it.`
  }
  if (questionNumber === 6) {
    return `For this role, ${skill} is important. What would you want to learn about the existing system before you made your first meaningful change?`
  }
  return `Before we wrap up, what is one decision from your experience that you would approach differently today, and why?`
}

function displayDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, "0")}`
}

type RemoteStart = {
  session: { id: string }
  openingQuestion: string
  questionNumber: number
  questionsTarget: number
}

type RemoteTurn = {
  question: string
  questionNumber: number
  questionsTarget: number
  completed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

async function authorizedHeaders(): Promise<HeadersInit> {
  const supabase = getSupabaseClient()
  if (!supabase) return { "Content-Type": "application/json" }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" }
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

/** The visual presence is independently reusable by future realtime transports. */
export function AIInterviewBubble({ state, audioLevel }: { state: InterviewVisualState; audioLevel: number }) {
  const visualStyle = {
    "--bubble-scale": `${1 + audioLevel * (state === "speaking" ? 0.1 : 0.045)}`,
    "--bubble-glow": `${28 + Math.round(audioLevel * 26)}px`,
  } as CSSProperties

  return (
    <div className={styles.bubbleWrap} style={visualStyle} data-state={state} aria-hidden="true">
      <span className={`${styles.wave} ${styles.waveOne}`} />
      <span className={`${styles.wave} ${styles.waveTwo}`} />
      <div className={styles.bubble}>
        <span className={styles.bubbleHighlight} />
      </div>
    </div>
  )
}

/** The primary microphone action stays intentionally lightweight and voice-first. */
export function InterviewMicrophoneButton({
  active,
  started,
  onClick,
}: {
  active: boolean
  started: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={styles.micControl}
      onClick={onClick}
      aria-label={active ? "Mute microphone" : started ? "Turn on microphone" : "Start AI interview"}
      aria-pressed={active}
      data-active={active}
    >
      {active ? <Mic aria-hidden="true" /> : started ? <MicOff aria-hidden="true" /> : <AudioLines aria-hidden="true" />}
      <span className="sr-only">{active ? "Mute microphone" : started ? "Turn on microphone" : "Start interview"}</span>
    </button>
  )
}

export function AIInterviewRoom({ context }: { context: AIInterviewContext }) {
  const [interviewState, setInterviewState] = useState<InterviewVisualState>("idle")
  const [audioLevel, setAudioLevel] = useState(0.08)
  const [micActive, setMicActive] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [questionNumber, setQuestionNumber] = useState(0)
  const [questionsTarget, setQuestionsTarget] = useState(TARGET_QUESTIONS)
  const [durationMinutes, setDurationMinutes] = useState<10 | 20 | 30>(20)
  const [secondsRemaining, setSecondsRemaining] = useState(DURATION_SECONDS)
  const [connectionMessage, setConnectionMessage] = useState("Ready when you are")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] = useState(false)
  const [evaluation, setEvaluation] = useState<InterviewEvaluation | null>(null)
  const [evaluationOpen, setEvaluationOpen] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const recognitionRef = useRef<BrowserRecognition | null>(null)
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null)
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interviewStateRef = useRef<InterviewVisualState>("idle")
  const micActiveRef = useRef(false)
  const questionRef = useRef(0)
  const sessionIdRef = useRef<string | null>(null)
  const startRecognitionRef = useRef<() => void>(() => undefined)
  const endInterviewRef = useRef<() => void>(() => undefined)
  const completeAfterSpeechRef = useRef(false)
  const processCandidateAnswerRef = useRef<(answer: string) => Promise<void>>(async () => undefined)
  const completePersistedInterviewRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    interviewStateRef.current = interviewState
  }, [interviewState])

  useEffect(() => {
    micActiveRef.current = micActive
  }, [micActive])

  useEffect(() => {
    setSpeechRecognitionAvailable(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition))
  }, [])

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return
    recognition.onend = null
    recognition.abort()
    recognitionRef.current = null
  }, [])

  const stopMicrophone = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
    audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    micActiveRef.current = false
    setMicActive(false)
    setAudioLevel(0.08)
  }, [])

  const startRecognition = useCallback(() => {
    if (!micActiveRef.current || interviewStateRef.current !== "listening") return
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      setConnectionMessage("Microphone is on. Live transcription is not supported in this browser.")
      return
    }

    const recognition = new Recognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = "en-US"
    recognition.onresult = (event) => {
      let finalText = ""
      let interimText = ""
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index]
        const text = result[0]?.transcript?.trim() ?? ""
        if (result.isFinal) finalText += `${text} `
        else interimText += `${text} `
      }
      setLiveTranscript((finalText || interimText).trim())
      if (finalText.trim()) {
        recognition.stop()
        recognitionRef.current = null
        const answer = finalText.trim()
        void processCandidateAnswerRef.current(answer)
      }
    }
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setErrorMessage("Live transcription is unavailable. You can still use the microphone visualizer.")
      }
    }
    recognition.onend = () => {
      recognitionRef.current = null
      if (interviewStateRef.current === "listening") setLiveTranscript("")
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      // Calling start while a browser recognition instance is closing is harmless.
    }
  }, [])

  const speak = useCallback((message: string) => {
    if (!("speechSynthesis" in window)) {
      setInterviewState("listening")
      setConnectionMessage("Listening…")
      setTimeout(startRecognition, 100)
      return
    }

    stopRecognition()
    setInterviewState("speaking")
    setConnectionMessage("AI Interviewer is speaking")
    const utterance = new SpeechSynthesisUtterance(message)
    utterance.rate = 0.96
    utterance.pitch = 1
    utterance.onend = () => {
      if (speechRef.current !== utterance) return
      if (completeAfterSpeechRef.current) {
        completeAfterSpeechRef.current = false
        endInterviewRef.current()
        return
      }
      setInterviewState("listening")
      setConnectionMessage("Listening…")
      setTimeout(startRecognition, 100)
    }
    utterance.onerror = () => {
      if (speechRef.current !== utterance) return
      if (completeAfterSpeechRef.current) {
        completeAfterSpeechRef.current = false
        endInterviewRef.current()
        return
      }
      setInterviewState("listening")
      setConnectionMessage("Listening…")
      setTimeout(startRecognition, 100)
    }
    speechRef.current = utterance
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [startRecognition, stopRecognition])

  const processCandidateAnswer = useCallback(async (answer: string) => {
    setTurns((current) => [
      ...current,
      { id: `candidate-${Date.now()}`, speaker: "candidate", text: answer },
    ])
    setLiveTranscript("")
    setInterviewState("thinking")
    setConnectionMessage("Thinking about your answer…")

    const interviewId = sessionIdRef.current
    if (interviewId) {
      try {
        const headers = await authorizedHeaders()
        const response = await fetch(`/api/ai-interview/${interviewId}/turn`, {
          method: "POST",
          headers,
          body: JSON.stringify({ transcript: answer }),
        })
        const body = await responseJson(response)
        if (response.ok && body && typeof body.question === "string") {
          const remote: RemoteTurn = {
            question: body.question,
            questionNumber: typeof body.questionNumber === "number" ? body.questionNumber : questionRef.current + 1,
            questionsTarget: typeof body.questionsTarget === "number" ? body.questionsTarget : questionsTarget,
            completed: body.completed === true,
          }
          questionRef.current = remote.questionNumber
          setQuestionNumber(remote.questionNumber)
          setQuestionsTarget(remote.questionsTarget)
          setTurns((current) => [
            ...current,
            { id: `interviewer-${Date.now()}`, speaker: "interviewer", text: remote.question },
          ])
          completeAfterSpeechRef.current = remote.completed
          speak(remote.question)
          return
        }
        if (response.status === 401 || response.status === 404 || response.status === 409) sessionIdRef.current = null
      } catch {
        // The local browser fallback keeps the conversation usable through a
        // transient network/provider failure. A completed local transcript is
        // still available in this room.
      }
    }

    const nextQuestion = questionRef.current + 1
    responseTimerRef.current = setTimeout(() => {
      if (nextQuestion > questionsTarget) {
        completeAfterSpeechRef.current = true
        const closing = "Thank you. That concludes our practice interview."
        setTurns((current) => [...current, { id: `interviewer-${Date.now()}`, speaker: "interviewer", text: closing }])
        speak(closing)
        return
      }
      questionRef.current = nextQuestion
      setQuestionNumber(nextQuestion)
      const question = followUpQuestion(context, nextQuestion, answer)
      setTurns((current) => [
        ...current,
        { id: `interviewer-${Date.now()}`, speaker: "interviewer", text: question },
      ])
      speak(question)
    }, 620)
  }, [context, questionsTarget, speak])

  useEffect(() => {
    processCandidateAnswerRef.current = processCandidateAnswer
  }, [processCandidateAnswer])

  useEffect(() => {
    startRecognitionRef.current = startRecognition
  }, [startRecognition])

  const connectMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("This browser cannot access a microphone. Try a current version of Chrome, Edge, Safari, or Firefox.")
      setInterviewState("error")
      return false
    }

    try {
      setConnectionMessage("Connecting your microphone…")
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext
      if (AudioContextClass) {
        const audioContext = new AudioContextClass()
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        audioContext.createMediaStreamSource(stream).connect(analyser)
        audioContextRef.current = audioContext
        const samples = new Uint8Array(analyser.frequencyBinCount)
        let lastLevel = 0.08
        let bargeFrames = 0
        const draw = () => {
          analyser.getByteTimeDomainData(samples)
          let total = 0
          for (const sample of samples) total += Math.abs(sample - 128)
          const level = Math.min(1, Math.max(0.04, total / samples.length / 38))
          const currentState = interviewStateRef.current
          if (Math.abs(level - lastLevel) > 0.018 && currentState === "listening") {
            lastLevel = level
            setAudioLevel(level)
          }
          // Echo cancellation handles most speaker bleed. Requiring several
          // consecutive loud microphone frames prevents a click or room noise
          // from cancelling the interviewer, while still allowing a natural
          // candidate interruption.
          if (currentState === "speaking") {
            bargeFrames = level > 0.22 ? bargeFrames + 1 : 0
            if (bargeFrames >= 4) {
              bargeFrames = 0
              const currentSpeech = speechRef.current
              speechRef.current = null
              if (currentSpeech && "speechSynthesis" in window) window.speechSynthesis.cancel()
              setInterviewState("interrupted")
              setConnectionMessage("I’m listening…")
              window.setTimeout(() => {
                if (!micActiveRef.current || interviewStateRef.current !== "interrupted") return
                interviewStateRef.current = "listening"
                setInterviewState("listening")
                startRecognitionRef.current()
              }, 120)
            }
          } else {
            bargeFrames = 0
          }
          animationFrameRef.current = requestAnimationFrame(draw)
        }
        draw()
      }
      micActiveRef.current = true
      setMicActive(true)
      setErrorMessage(null)
      return true
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ""
      setErrorMessage(
        name === "NotAllowedError"
          ? "Microphone permission was not granted. Allow microphone access to begin the interview."
          : "We could not connect to your microphone. Check that it is available and try again.",
      )
      setInterviewState("error")
      setConnectionMessage("Microphone needs attention")
      return false
    }
  }, [])

  const completePersistedInterview = useCallback(async () => {
    const interviewId = sessionIdRef.current
    if (!interviewId) {
      setConnectionMessage("Interview complete. Your transcript is ready to review.")
      return
    }
    setConnectionMessage("Preparing your job-specific practice assessment…")
    try {
      const headers = await authorizedHeaders()
      const response = await fetch(`/api/ai-interview/${interviewId}/complete`, { method: "POST", headers })
      const body = await responseJson(response)
      if (response.ok && body?.evaluation && isRecord(body.evaluation)) {
        setEvaluation(body.evaluation as InterviewEvaluation)
        setConnectionMessage("Your job-specific feedback is ready.")
        return
      }
    } catch {
      // The in-room transcript remains available even if assessment generation
      // cannot be reached. The session can be retrieved later when configured.
    }
    setConnectionMessage("Interview complete. Your transcript is ready to review.")
  }, [])

  useEffect(() => {
    completePersistedInterviewRef.current = completePersistedInterview
  }, [completePersistedInterview])

  const startInterview = useCallback(async () => {
    if (interviewState === "completed") {
      setTurns([])
      setQuestionNumber(0)
      questionRef.current = 0
      setQuestionsTarget(TARGET_QUESTIONS)
      setSecondsRemaining(durationMinutes * 60)
      sessionIdRef.current = null
      setEvaluation(null)
      completeAfterSpeechRef.current = false
    }
    setInterviewState("starting")
    const connected = await connectMicrophone()
    if (!connected) return
    setHasStarted(true)
    questionRef.current = 1
    setQuestionNumber(1)
    setSecondsRemaining(durationMinutes * 60)
    let opening = openingQuestion(context)
    let target = durationMinutes === 10 ? 4 : durationMinutes === 30 ? 12 : TARGET_QUESTIONS
    if (context.jobId) {
      try {
        const headers = await authorizedHeaders()
        const response = await fetch("/api/ai-interview/start", {
          method: "POST",
          headers,
          body: JSON.stringify({
            jobId: context.jobId,
            durationMinutes,
            interviewType: context.interviewType ?? "mixed",
          }),
        })
        const body = await responseJson(response)
        if (response.ok && body && isRecord(body.session) && typeof body.session.id === "string" && typeof body.openingQuestion === "string") {
          const remote = body as unknown as RemoteStart
          sessionIdRef.current = remote.session.id
          opening = remote.openingQuestion
          target = typeof remote.questionsTarget === "number" ? remote.questionsTarget : target
        }
      } catch {
        // No provider/network/auth is required for the private browser voice
        // fallback. It starts with the same job context and keeps audio local.
      }
    }
    setQuestionsTarget(target)
    setTurns([{ id: `interviewer-${Date.now()}`, speaker: "interviewer", text: opening }])
    speak(opening)
  }, [connectMicrophone, context, durationMinutes, interviewState, speak])

  const toggleMicrophone = useCallback(async () => {
    if (!hasStarted || interviewState === "error" || interviewState === "completed") {
      await startInterview()
      return
    }
    if (micActive) {
      stopRecognition()
      stopMicrophone()
      setConnectionMessage("Microphone muted")
      return
    }
    const connected = await connectMicrophone()
    if (connected) {
      setInterviewState("listening")
      setConnectionMessage("Listening…")
      setTimeout(startRecognition, 100)
    }
  }, [connectMicrophone, hasStarted, interviewState, micActive, startInterview, startRecognition, stopMicrophone, stopRecognition])

  const endInterview = useCallback(() => {
    if (responseTimerRef.current) clearTimeout(responseTimerRef.current)
    stopRecognition()
    stopMicrophone()
    speechRef.current = null
    if ("speechSynthesis" in window) window.speechSynthesis.cancel()
    setLiveTranscript("")
    setInterviewState("completed")
    void completePersistedInterviewRef.current()
  }, [stopMicrophone, stopRecognition])

  useEffect(() => {
    endInterviewRef.current = endInterview
  }, [endInterview])

  useEffect(() => {
    if (!hasStarted || interviewState === "completed") return
    const clock = window.setInterval(() => {
      setSecondsRemaining((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(clock)
  }, [hasStarted, interviewState])

  useEffect(() => {
    if (secondsRemaining !== 0) return
    endInterview()
  }, [endInterview, secondsRemaining])

  useEffect(() => {
    if (interviewState !== "speaking") return
    let animationFrame = 0
    const animate = (time: number) => {
      setAudioLevel(0.16 + Math.abs(Math.sin(time / 360)) * 0.18)
      animationFrame = requestAnimationFrame(animate)
    }
    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [interviewState])

  useEffect(() => () => {
    if (responseTimerRef.current) clearTimeout(responseTimerRef.current)
    stopRecognition()
    stopMicrophone()
    if ("speechSynthesis" in window) window.speechSynthesis.cancel()
  }, [stopMicrophone, stopRecognition])

  const latestInterviewerMessage = [...turns].reverse().find((turn) => turn.speaker === "interviewer")?.text
  const stateLabel: Record<InterviewVisualState, string> = {
    idle: "Ready when you are",
    starting: "Preparing your interview…",
    speaking: "AI Interviewer is speaking",
    listening: "Listening…",
    thinking: "Thinking about your answer…",
    interrupted: "Listening…",
    reconnecting: "Reconnecting…",
    completed: "Interview complete",
    error: "Microphone needs attention",
  }

  const cycleDuration = () => {
    if (hasStarted) {
      setConnectionMessage(`A focused ${durationMinutes}-minute practice interview.`)
      return
    }
    setDurationMinutes((current) => current === 10 ? 20 : current === 20 ? 30 : 10)
  }

  return (
    <main className={styles.room} data-state={interviewState}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.header}>
        <a href={context.jobId ? `/jobs/${context.jobId.split(":").map(encodeURIComponent).join("/")}` : "/jobs"} className={styles.backLink}>
          <span aria-hidden="true">←</span> Jobs
        </a>
        <div className={styles.jobContext}>
          <p>AI INTERVIEW</p>
          <h1>{context.jobTitle}</h1>
          <span>{context.companyName}</span>
        </div>
        {hasStarted && interviewState !== "completed" ? (
          <button type="button" className={styles.endButton} onClick={endInterview}>
            End interview
          </button>
        ) : (
          <span className={styles.privacy}>Private practice</span>
        )}
      </header>

      {hasStarted && (
        <div className={styles.progress} aria-label={`Question ${Math.max(questionNumber, 1)} of approximately ${questionsTarget}; ${displayDuration(secondsRemaining)} remaining`}>
          <span>Question {Math.max(questionNumber, 1)} of ~{questionsTarget}</span>
          <i aria-hidden="true" style={{ "--progress": `${Math.min(1, questionNumber / questionsTarget)}` } as CSSProperties} />
          <span>{displayDuration(secondsRemaining)} remaining</span>
        </div>
      )}

      <section className={styles.stage} aria-live="polite">
        <span className={`${styles.particle} ${styles.particleOne}`} aria-hidden="true" />
        <span className={`${styles.particle} ${styles.particleTwo}`} aria-hidden="true" />
        <span className={`${styles.particle} ${styles.particleThree}`} aria-hidden="true" />

        <AIInterviewBubble state={interviewState} audioLevel={audioLevel} />

        <div className={styles.message}>
          {interviewState === "idle" ? (
            <>
              <p className={styles.eyebrow}>Ready when you are</p>
              <h2>Hello!</h2>
              <p>I’m your AI interviewer.</p>
              <p className={styles.intro}>We’ll practice for <strong>{context.jobTitle}</strong> with a focused, natural conversation.</p>
            </>
          ) : interviewState === "completed" ? (
            <>
              <p className={styles.eyebrow}>Practice session complete</p>
              <h2>Thank you.</h2>
              <p>Your conversation is ready to review.</p>
            </>
          ) : interviewState === "error" ? (
            <>
              <p className={styles.eyebrow}>Microphone access</p>
              <h2>Let’s get you connected.</h2>
              <p>{errorMessage}</p>
            </>
          ) : (
            <>
              <p className={styles.eyebrow}>{interviewState === "speaking" ? "AI Interviewer" : stateLabel[interviewState]}</p>
              <h2 className={styles.question}>“{latestInterviewerMessage ?? "I’m preparing your first question."}”</h2>
              {liveTranscript && <p className={styles.liveTranscript}>{liveTranscript}</p>}
            </>
          )}
        </div>
      </section>

      <footer className={styles.controls}>
        <button type="button" className={styles.sideControl} onClick={evaluation ? () => setEvaluationOpen(true) : cycleDuration}>
          <Sparkles aria-hidden="true" />
          <span>{evaluation ? "Feedback" : hasStarted ? "Interview" : `${durationMinutes} min`}</span>
        </button>
        <InterviewMicrophoneButton active={micActive} started={hasStarted} onClick={toggleMicrophone} />
        <button type="button" className={styles.sideControl} onClick={() => setTranscriptOpen(true)}>
          <FileText aria-hidden="true" />
          <span>Transcript</span>
        </button>
      </footer>

      <p className={styles.status} data-state={interviewState}>
        <span aria-hidden="true" />
        {connectionMessage}
        {speechRecognitionAvailable && micActive && interviewState === "listening" ? <em> Voice ready</em> : null}
      </p>

      <Sheet open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <SheetContent side="right" className={styles.transcriptSheet}>
          <SheetHeader>
            <SheetTitle>Your interview transcript</SheetTitle>
            <SheetDescription>
              Review your conversation without leaving the interview room.
            </SheetDescription>
          </SheetHeader>
          <div className={styles.transcriptList}>
            {turns.length ? turns.map((turn) => (
              <article key={turn.id} className={styles.transcriptTurn} data-speaker={turn.speaker}>
                <div>
                  {turn.speaker === "interviewer" ? <Volume2 aria-hidden="true" /> : <Mic aria-hidden="true" />}
                  <span>{turn.speaker === "interviewer" ? "AI Interviewer" : "You"}</span>
                </div>
                <p>{turn.text}</p>
              </article>
            )) : (
              <p className={styles.emptyTranscript}>Your conversation will appear here once the interview begins.</p>
            )}
          </div>
          {hasStarted && interviewState !== "completed" && (
            <button type="button" className={styles.sheetEndButton} onClick={endInterview}>
              <PhoneOff aria-hidden="true" /> End interview
            </button>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={evaluationOpen} onOpenChange={setEvaluationOpen}>
        <SheetContent side="right" className={styles.transcriptSheet}>
          <SheetHeader>
            <SheetTitle>Your practice assessment</SheetTitle>
            <SheetDescription>
              {evaluation?.disclaimer ?? "Job-specific feedback will appear here after the interview."}
            </SheetDescription>
          </SheetHeader>
          {evaluation ? (
            <div className={styles.evaluationList}>
              <section className={styles.readiness}>
                <span>Overall readiness</span>
                <strong>{evaluation.overallReadiness}<small>/100</small></strong>
              </section>
              <section className={styles.scoreGrid} aria-label="Practice assessment scores">
                {[
                  ["Technical", evaluation.scores.technical],
                  ["Communication", evaluation.scores.communication],
                  ["Problem solving", evaluation.scores.problemSolving],
                  ["Role fit", evaluation.scores.roleFit],
                  ["Behavioral", evaluation.scores.behavioral],
                ].map(([label, score]) => (
                  <div key={label as string}><span>{label}</span><strong>{score}</strong></div>
                ))}
              </section>
              <section className={styles.feedbackSection}>
                <h3>Job requirements</h3>
                {evaluation.requirementAssessments.map((item) => (
                  <article key={item.skill} className={styles.requirement} data-level={item.level}>
                    <div><strong>{item.skill}</strong><span>{item.score}/100</span></div>
                    <i aria-hidden="true"><b style={{ width: `${item.score}%` }} /></i>
                    <p>{item.evidence}</p>
                  </article>
                ))}
              </section>
              <section className={styles.feedbackSection}>
                <h3>Strong signals</h3>
                <ul>{evaluation.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
              <section className={styles.feedbackSection}>
                <h3>Next practice</h3>
                <ul>{evaluation.recommendedPractice.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
              <section className={styles.feedbackSection}>
                <h3>Biggest gap</h3>
                <p>{evaluation.biggestGap}</p>
              </section>
              {evaluation.bestAnswer && (
                <section className={styles.feedbackSection}>
                  <h3>Best answer</h3>
                  <blockquote>“{evaluation.bestAnswer.transcript}”</blockquote>
                  <p>{evaluation.bestAnswer.explanation}</p>
                </section>
              )}
            </div>
          ) : (
            <p className={styles.emptyTranscript}>Finish a signed-in interview to receive role-specific feedback.</p>
          )}
        </SheetContent>
      </Sheet>
    </main>
  )
}
