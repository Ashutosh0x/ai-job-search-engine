# AI Interview

`/ai-interview` is a calm, full-screen practice room for a selected job. It is
opened from a job detail page and deliberately avoids a dashboard/chat layout:
the microphone-driven, organic bubble is the primary interface; transcript and
feedback stay secondary in side panels.

## What is implemented

```text
job detail
  → /ai-interview?jobId=<canonical id>
  → server validates the job against the served index
  → microphone permission after an explicit candidate action
  → browser speech recognition / synthesis where available
  → authenticated session start (optional, persistent path)
      → trusted job + current profile/resume context
      → provider-neutral interview planner
      → structured transcript turns and adaptive next question
      → job-requirement evaluation at completion
```

The browser fallback remains fully usable when the candidate is not signed in,
Supabase is not configured, or a provider is unavailable. It uses the selected
job title and skills for a local practice conversation, keeps the microphone
audio and transcript in the browser, and never claims that it produced a
persisted assessment.

## Architecture

| Area | Implementation |
|---|---|
| UI | `app/ai-interview/page.tsx` resolves the optional canonical job id, and `components/ai-interview-room.tsx` owns the reusable floating room. `AIInterviewBubble` behaviour is represented by the bubble renderer, audio-level controller, particles, and state styles inside that room. |
| Visual state | `lib/ai-interview/types.ts` defines `idle`, `starting`, `speaking`, `listening`, `thinking`, `interrupted`, `reconnecting`, `completed`, and `error`, plus testable valid transitions. |
| Voice fallback | `getUserMedia` + `AudioContext` supplies a smoothed amplitude. Browser `speechSynthesis` speaks prompts and `SpeechRecognition`/`webkitSpeechRecognition` supplies text where the browser supports it. Candidate speech during synthesis cancels the utterance and returns to listening. |
| Interview engine | `lib/ai-interview/interviewer.ts` provides an `InterviewProvider` interface, a Gemini implementation, and a deterministic local fallback for planning, next-turn decisions, and evaluation. |
| Persistence | `interview_sessions` and `interview_turns` retain structured text/metadata through service-side routes only. Raw microphone audio is never recorded or stored. |
| Context | The server re-resolves the job from its canonical id. It reads the current signed-in profile and most recent parsed resume only for provider context; raw resume text is not copied into the interview tables. |

The provider interfaces are intentionally separate from UI and persistence:

```ts
interface InterviewProvider {
  createPlan(context): Promise<InterviewPlan>
  nextTurn({ context, plan, turns, answer }): Promise<NextInterviewTurn>
  evaluate({ context, plan, turns }): Promise<InterviewEvaluation>
}
```

This is the boundary for a future low-latency WebRTC transport, streaming STT,
and streaming TTS. The current browser voice layer is a progressive
enhancement, not a substitute for a hosted realtime transport.

## API

All persisted endpoints require a valid Supabase access token (`Authorization:
Bearer <token>` or the supported session cookie), verify ownership server-side,
and validate ids/payload sizes.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/ai-interview/start` | Validates a canonical job, plans an interview, stores the opening turn. |
| `GET` | `/api/ai-interview/:id` | Reads a safe session summary owned by the caller. |
| `POST` | `/api/ai-interview/:id/turn` | Stores a candidate transcript turn and returns one adaptive next question. |
| `POST` | `/api/ai-interview/:id/complete` | Produces and stores the job-specific practice assessment. Idempotent after completion. |
| `GET` | `/api/ai-interview/:id/evaluation` | Reads the completed assessment. |
| `GET` | `/api/ai-interview/:id/transcript` | Reads the owned structured transcript. |

Provider latency is recorded as session metadata (`plannerLatencyMs`,
`lastLlmLatencyMs`, `evaluationLatencyMs`). The browser can send STT latency
when it has it; the Web Speech fallback does not expose a reliable value.

## Setup

1. Apply `supabase/migrations/20260915010000_create_ai_interviews.sql` to the
   existing Supabase project.
2. Configure the existing Supabase variables and service role key. Persisted
   interviews require `SUPABASE_SERVICE_ROLE_KEY`; an anon key is deliberately
   not accepted for writes.
3. Set `GEMINI_API_KEY` for generated planning, follow-ups, and evaluation.
   `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`.
4. Run `npm run dev`, open a job, and select **AI Interview**.

No new package is required. The existing `@google/generative-ai`, Supabase,
Zod, Lucide, and Radix Sheet dependencies are reused.

## Privacy and safety

- Microphone permission is requested only after the candidate starts.
- Raw audio is never uploaded, recorded, or persisted.
- Only authenticated service-side routes can insert turns or write an
  evaluation; the client cannot forge a score through row-level security.
- Job ids are validated against the served index, so query-string text never
  becomes model context.
- Resume/profile context stays server-side and is bounded before prompting.
- The assessment is clearly labelled as an AI-generated practice assessment,
  not a prediction of hiring outcomes.
- Permission denial, missing microphone, browser speech limitations, and
  provider/network fallbacks are visible in the room rather than silent.

## Current limitations and next steps

Browser `SpeechRecognition` support varies substantially and browser
`speechSynthesis` cannot expose true output audio levels. The current model
calls are request/response turns, not a bidirectional streaming WebRTC agent.

The next production phase should add a short-lived LiveKit (or equivalent)
token endpoint, streaming STT/TTS adapters, server-side VAD/turn detection,
cancelable streamed TTS, transcript retry/reconnect, shared distributed rate
limits, and retention/deletion controls appropriate to the product's privacy
policy. Those additions can use `InterviewProvider` without changing the room
or its data model.
