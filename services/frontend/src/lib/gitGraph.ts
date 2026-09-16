import type { GitCommit } from '../types'

export type GitGraphLane = { sha: string; tone: number }

export type GitGraphRow = {
  commit: GitCommit
  before: GitGraphLane[]
  after: GitGraphLane[]
  lane: number
  tone: number
  parentLanes: number[]
}

const laneToneCount = 6

/**
 * Builds the visible lane topology for a reverse-chronological git log.
 * The first parent inherits the current lane tone, while merge parents open a
 * new lane. Existing lanes keep their tone as they cross or collapse.
 */
export function buildGitGraphRows(commits: GitCommit[]): GitGraphRow[] {
  const rows: GitGraphRow[] = []
  let lanes: GitGraphLane[] = []
  let nextTone = 0

  const allocateTone = () => {
    const tone = nextTone % laneToneCount
    nextTone += 1
    return tone
  }

  for (const commit of commits) {
    let lane = lanes.findIndex((item) => item.sha === commit.sha)
    if (lane < 0) {
      lanes = [{ sha: commit.sha, tone: allocateTone() }, ...lanes]
      lane = 0
    }

    const before = lanes.map((item) => ({ ...item }))
    const currentTone = before[lane]?.tone ?? 0
    const after = before.filter((_, index) => index !== lane)
    const parentLanes: number[] = []

    for (const [parentIndex, parentSHA] of (commit.parents || []).entries()) {
      let target = after.findIndex((item) => item.sha === parentSHA)
      if (target < 0) {
        const insertAt = Math.min(lane + parentIndex, after.length)
        after.splice(insertAt, 0, {
          sha: parentSHA,
          tone: parentIndex === 0 ? currentTone : allocateTone(),
        })
        target = insertAt
      }
      parentLanes.push(target)
    }

    rows.push({ commit, before, after: after.map((item) => ({ ...item })), lane, tone: currentTone, parentLanes })
    lanes = after
  }

  return rows
}
