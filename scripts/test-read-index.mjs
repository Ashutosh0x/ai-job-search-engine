/** Regression tests for the streaming full-index reader. */
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readIndexJobs, streamIndexSync } from '../lib/pipeline/read-index.mjs'

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) {
    pass++
    console.log('  ok   ' + name)
  } else {
    fail++
    console.log('  FAIL ' + name, got !== undefined ? '-> ' + JSON.stringify(got) : '')
  }
}

const dir = await mkdtemp(join(tmpdir(), 'read-index-'))
const file = join(dir, 'index.json')

try {
  // The first job crosses the reader's 4 MiB chunk boundary. Its string also
  // includes escaped quotes and braces, which must not confuse brace tracking.
  const jobs = [
    {
      externalId: 'large',
      title: 'Large record',
      descriptionText: 'x'.repeat(4 * 1024 * 1024) + ' \\"{not a brace}\\"',
    },
    { externalId: 'second', title: 'Second record', descriptionText: 'still read after a chunk boundary' },
    { externalId: 'third', title: 'Third record', descriptionText: 'final record' },
  ]
  await writeFile(file, JSON.stringify({ generatedAt: '2026-09-15T00:00:00.000Z', sources: ['test'], jobs }))

  const read = readIndexJobs(file)
  t('reads every job across a chunk boundary', read.jobs.length === 3, read.jobs.length)
  t('preserves the oversized record', read.jobs[0]?.descriptionText === jobs[0].descriptionText)
  t('preserves records after the oversized one', read.jobs[2]?.externalId === 'third', read.jobs.map((j) => j.externalId))
  t('parses the index header', read.head?.generatedAt === '2026-09-15T00:00:00.000Z', read.head)

  const ids = []
  const streamed = streamIndexSync(file, (job, i) => ids.push(i + ':' + job.externalId))
  t('callback order is stable', ids.join(',') === '0:large,1:second,2:third', ids)
  t('stream count agrees with collected jobs', streamed.count === read.jobs.length, streamed.count)
} finally {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
