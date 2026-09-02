export const MAX_PLAYERS = 20
export const PHOTO_COUNT = 3

export type GameStatus = 'draft' | 'published' | 'live' | 'finished'

export type PersonPage = {
  id: string
  personName: string
  header: string
  description: string
  photoUrls: [string, string, string]
}

export type GameRecord = {
  id: string
  title: string
  code: string
  status: GameStatus
  activePageIndex: number
  pages: PersonPage[]
  createdBy: string
  createdAtMs: number
  updatedAtMs: number
}

export type PlayerRecord = {
  id: string
  displayName: string
  normalizedName: string
  guesses: Record<string, string>
  joinedAtMs: number
  updatedAtMs: number
}

const CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function createRandomIndex(max: number) {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return buffer[0]! % max
  }

  return Math.floor(Math.random() * max)
}

export function createLocalId(length = 12) {
  return Array.from({ length }, () => CODE_CHARACTERS[createRandomIndex(CODE_CHARACTERS.length)]).join('')
}

export function createGameCode(length = 5) {
  return createLocalId(length)
}

export function emptyPhotoUrls(): [string, string, string] {
  return ['', '', '']
}

export function createEmptyPage(): PersonPage {
  return {
    id: createLocalId(),
    personName: '',
    header: '',
    description: '',
    photoUrls: emptyPhotoUrls(),
  }
}

export function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function cloneGameRecord(game: GameRecord): GameRecord {
  return {
    ...game,
    pages: game.pages.map((page) => ({
      ...page,
      photoUrls: [...page.photoUrls] as [string, string, string],
    })),
  }
}

export function validateGameDraft(game: Pick<GameRecord, 'title' | 'pages'>) {
  const errors: string[] = []

  if (!game.title.trim()) {
    errors.push('Game title is required.')
  }

  if (game.pages.length === 0) {
    errors.push('Add at least one person page.')
  }

  game.pages.forEach((page, pageIndex) => {
    if (!page.personName.trim()) {
      errors.push(`Page ${pageIndex + 1}: correct person name is required.`)
    }

    page.photoUrls.forEach((photoUrl, photoIndex) => {
      if (!photoUrl.trim()) {
        errors.push(`Page ${pageIndex + 1}: photo link ${photoIndex + 1} is required.`)
        return
      }

      if (!isValidHttpUrl(photoUrl.trim())) {
        errors.push(`Page ${pageIndex + 1}: photo link ${photoIndex + 1} must be a valid http or https URL.`)
      }
    })
  })

  return errors
}

export function sanitizePages(pages: PersonPage[]) {
  return pages.map((page) => ({
    ...page,
    personName: page.personName.trim(),
    header: page.header.trim(),
    description: page.description.trim(),
    photoUrls: page.photoUrls.map((photoUrl) => photoUrl.trim()) as [string, string, string],
  }))
}

export function scorePlayer(player: PlayerRecord, pages: PersonPage[]) {
  return pages.reduce((total, page) => {
    return normalizeText(player.guesses[page.id] ?? '') === normalizeText(page.personName) ? total + 1 : total
  }, 0)
}

export function sortPlayersByScore(players: PlayerRecord[], pages: PersonPage[]) {
  return [...players].sort((left, right) => {
    const rightScore = scorePlayer(right, pages)
    const leftScore = scorePlayer(left, pages)

    if (rightScore !== leftScore) {
      return rightScore - leftScore
    }

    return left.displayName.localeCompare(right.displayName)
  })
}

export function formatStatus(status: GameStatus) {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'published':
      return 'Published'
    case 'live':
      return 'Live'
    case 'finished':
      return 'Finished'
  }
}

export function coercePhotoUrls(value: unknown): [string, string, string] {
  const source = Array.isArray(value) ? value : []
  return [0, 1, 2].map((index) => `${source[index] ?? ''}`) as [string, string, string]
}

export function coerceGameRecord(id: string, value: unknown): GameRecord {
  const game = typeof value === 'object' && value !== null ? value as Partial<GameRecord> : {}
  const pages = Array.isArray(game.pages) ? game.pages : []

  return {
    id,
    title: `${game.title ?? ''}`,
    code: `${game.code ?? ''}`.toUpperCase(),
    status:
      game.status === 'published' || game.status === 'live' || game.status === 'finished'
        ? game.status
        : 'draft',
    activePageIndex: Number.isInteger(game.activePageIndex) ? Math.max(0, game.activePageIndex ?? 0) : 0,
    pages: pages.map((page) => {
      const nextPage = typeof page === 'object' && page !== null ? page as Partial<PersonPage> : {}
      return {
        id: `${nextPage.id ?? createLocalId()}`,
        personName: `${nextPage.personName ?? ''}`,
        header: `${nextPage.header ?? ''}`,
        description: `${nextPage.description ?? ''}`,
        photoUrls: coercePhotoUrls(nextPage.photoUrls),
      }
    }),
    createdBy: `${game.createdBy ?? ''}`,
    createdAtMs: typeof game.createdAtMs === 'number' ? game.createdAtMs : Date.now(),
    updatedAtMs: typeof game.updatedAtMs === 'number' ? game.updatedAtMs : Date.now(),
  }
}

export function coercePlayerRecord(id: string, value: unknown): PlayerRecord {
  const player = typeof value === 'object' && value !== null ? value as Partial<PlayerRecord> : {}
  const guesses = typeof player.guesses === 'object' && player.guesses !== null ? player.guesses : {}

  return {
    id,
    displayName: `${player.displayName ?? ''}`,
    normalizedName: `${player.normalizedName ?? ''}`,
    guesses: Object.fromEntries(
      Object.entries(guesses).map(([pageId, guess]) => [pageId, `${guess ?? ''}`]),
    ),
    joinedAtMs: typeof player.joinedAtMs === 'number' ? player.joinedAtMs : Date.now(),
    updatedAtMs: typeof player.updatedAtMs === 'number' ? player.updatedAtMs : Date.now(),
  }
}
