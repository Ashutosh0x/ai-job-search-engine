/**
 * Read an index file this pipeline wrote, without holding it as one string.
 *
 * WHY
 * ===
 * Node caps a string at ~512MB. The index passed that at 530MB, and every
 * consumer broke at once -- refresh could not read its own base file, the
 * deploy-index builder could not read its input, and the app loader caught the
 * error and silently served a 14MB v1 snapshot (9,648 jobs) while 238,620 sat
 * on disk.
 *
 * WHY BYTES AND NOT CHARACTERS
 * ----------------------------
 * A first attempt scanned the decoded string character by character and did not
 * finish in ten minutes: 530M UTF-16 iterations in JS is simply too slow. A
 * Buffer holds far more than a string (~2GB) and scanning it as BYTES avoids
 * the decode entirely, so only the bytes of an individual record are ever
 * turned into a string.
 *
 * The shape is fixed because writeJsonStream produced it:
 *     {"key":val,...,"jobs":[ {...},{...},... ]}
 * Depth and in-string tracking are still required -- jobs contain nested
 * objects (visaEvidence) and braces inside description text.
 */

import { readFileSync } from 'fs'

const OPEN = 0x7b        // {
const CLOSE = 0x7d       // }
const QUOTE = 0x22       // "
const BACKSLASH = 0x5c   // \

/**
 * @param onJob called with each parsed job; return value ignored
 * @returns { head, count }
 */
export function streamIndexSync(path, onJob) {
  const buf = readFileSync(path)           // Buffer, not string: no 512MB cap
  const marker = buf.indexOf('"jobs":[')
  if (marker === -1) throw new Error(`${path} has no "jobs" array`)

  let head = null
  try {
    head = JSON.parse(buf.subarray(0, marker).toString('utf8').replace(/,\s*$/, '') + '}')
  } catch { /* header is advisory; a bad one must not stop the records */ }

  let i = marker + '"jobs":['.length
  const end = buf.length
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1
  let count = 0

  while (i < end) {
    const b = buf[i]
    if (inString) {
      if (escaped) escaped = false
      else if (b === BACKSLASH) escaped = true
      else if (b === QUOTE) inString = false
    } else if (b === QUOTE) {
      inString = true
    } else if (b === OPEN) {
      if (depth === 0) start = i
      depth++
    } else if (b === CLOSE) {
      depth--
      if (depth === 0 && start !== -1) {
        try {
          onJob(JSON.parse(buf.subarray(start, i + 1).toString('utf8')), count)
          count++
        } catch { /* skip one malformed record rather than abandon the file */ }
        start = -1
      }
    }
    i++
  }

  return { head, count }
}

/** Convenience: collect every job into an array. */
export function readIndexJobs(path) {
  const jobs = []
  const { head, count } = streamIndexSync(path, (j) => jobs.push(j))
  return { head, jobs, count }
}
