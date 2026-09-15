/**
 * Read an index file this pipeline wrote without loading the whole artifact
 * into one Node Buffer. Full indexes are now larger than Node's 2 GiB Buffer
 * limit, so a synchronous readFileSync is no longer a viable "stream".
 *
 * The shape is fixed because writeJsonStream produced it:
 *     {"key":val,...,"jobs":[ {...},{...},... ]}
 *
 * We scan bytes rather than decoded characters and only decode one completed
 * job object. Brace depth, strings and escapes carry across chunk boundaries.
 */

import { closeSync, openSync, readSync } from 'fs'

const OPEN = 0x7b
const CLOSE = 0x7d
const QUOTE = 0x22
const BACKSLASH = 0x5c
const JOBS_MARKER = Buffer.from('"jobs":[')
const CHUNK_BYTES = 4 * 1024 * 1024

/**
 * @param onJob called with each parsed job; return value ignored
 * @returns { head, count }
 */
export function streamIndexSync(path, onJob) {
  const fd = openSync(path, 'r')
  let position = 0
  let foundJobs = false
  let markerTail = Buffer.alloc(0)
  const headerParts = []
  let head = null
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1
  let recordParts = []
  let count = 0

  try {
    for (;;) {
      const chunk = Buffer.allocUnsafe(CHUNK_BYTES)
      const bytes = readSync(fd, chunk, 0, chunk.length, position)
      if (!bytes) break
      position += bytes
      let buf = chunk.subarray(0, bytes)

      if (!foundJobs) {
        // Preserve just enough unscanned data to recognise a marker split
        // across reads. The header is small; job data is never accumulated.
        if (markerTail.length) buf = Buffer.concat([markerTail, buf])
        const marker = buf.indexOf(JOBS_MARKER)
        if (marker === -1) {
          const keep = Math.min(JOBS_MARKER.length - 1, buf.length)
          if (buf.length > keep) headerParts.push(buf.subarray(0, buf.length - keep))
          markerTail = buf.subarray(buf.length - keep)
          continue
        }

        foundJobs = true
        if (marker) headerParts.push(buf.subarray(0, marker))
        markerTail = Buffer.alloc(0)
        try {
          head = JSON.parse(Buffer.concat(headerParts).toString('utf8').replace(/,\s*$/, '') + '}')
        } catch {
          // Header metadata is advisory; a bad header must not stop the jobs.
        }
        buf = buf.subarray(marker + JOBS_MARKER.length)
      }

      let i = 0
      while (i < buf.length) {
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
            recordParts.push(buf.subarray(start, i + 1))
            try {
              onJob(JSON.parse(Buffer.concat(recordParts).toString('utf8')), count)
              count++
            } catch {
              // Skip one malformed record rather than abandon a whole index.
            }
            recordParts = []
            start = -1
          }
        }
        i++
      }

      // Carry the unfinished object's suffix into the next chunk. The next
      // buffer starts at byte zero, so reset the start offset accordingly.
      if (depth > 0 && start !== -1) {
        recordParts.push(buf.subarray(start))
        start = 0
      }
    }
  } finally {
    closeSync(fd)
  }

  if (!foundJobs) throw new Error(path + ' has no "jobs" array')
  return { head, count }
}

/** Convenience: collect every job into an array. */
export function readIndexJobs(path) {
  const jobs = []
  const { head, count } = streamIndexSync(path, (j) => jobs.push(j))
  return { head, jobs, count }
}
