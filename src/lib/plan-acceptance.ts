import { requestError } from './errors'

export type AcceptanceProgress = { saved: boolean }

/** A committed save followed by a failed read must be retried as a read, not a write. */
export async function completePlanAcceptance(progress: AcceptanceProgress, actions: {
  save: () => Promise<void>
  hasSaved?: () => Promise<boolean>
  verify: () => Promise<void>
  reload: () => Promise<void>
  close: () => void
}): Promise<void> {
  if (!progress.saved) {
    try { await actions.save() } catch (error) {
      // A transport error can arrive after COMMIT. Read the receipt before a
      // retry; never replay a write just because its acknowledgement was lost.
      if (!actions.hasSaved || !await actions.hasSaved().catch(() => false)) throw error
    }
    progress.saved = true
  }
  try {
    await actions.verify()
    await actions.reload()
  } catch (error) {
    throw requestError('The layout was saved, but its reload could not be verified. Your review is retained; retry to reload', error)
  }
  actions.close()
}

/** JSONB object-key ordering is irrelevant; array ordering remains meaningful. */
export function sameSavedValue(left: unknown, right: unknown): boolean {
  const normalized = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalized)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]))
    return value
  }
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))
}
