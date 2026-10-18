import { initializeGeneratedProject } from './generateApp'

// Bundled data only. This demo never calls a Provider or imports generated source.
const fixtureJSON = '{"version":2,"id":"focus-app","name":"考试专注番茄钟","entities":[],"blocks":[{"id":"focus-timer","name":"数学专注","type":"pomodoro","protocolVersion":1,"durationSeconds":1500}],"relations":[]}'

export const trustedPomodoroSource = '离线固定 Fixture，非真实 DeepSeek 调用'

export async function loadTrustedPomodoroFixture(signal?: AbortSignal) {
  signal?.throwIfAborted()
  await Promise.resolve()
  signal?.throwIfAborted()
  // Validate the complete spec and initialized project before exposing any result.
  return initializeGeneratedProject(JSON.parse(fixtureJSON))
}
