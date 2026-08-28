import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Mode = 'creator' | 'presenter' | 'player'
type GameStage = 'setup' | 'playing' | 'finished'

type PersonPage = {
  id: string
  personName: string
  header: string
  description: string
  photoUrls: string[]
}

type Player = {
  id: string
  name: string
  guesses: Record<string, string>
}

type GameState = {
  stage: GameStage
  pages: PersonPage[]
  players: Player[]
  presenterIndex: number
  activePlayerId: string | null
}

const MAX_PARTICIPANTS = 20
const PHOTO_COUNT = 3
const STORAGE_KEY = 'photoguessing-state-v1'

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createEmptyPage(): PersonPage {
  return {
    id: createId(),
    personName: '',
    header: '',
    description: '',
    photoUrls: Array.from({ length: PHOTO_COUNT }, () => ''),
  }
}

function createInitialState(): GameState {
  return {
    stage: 'setup',
    pages: [createEmptyPage()],
    players: [],
    presenterIndex: 0,
    activePlayerId: null,
  }
}

function parseStoredState(): GameState {
  if (typeof window === 'undefined') {
    return createInitialState()
  }

  const rawState = window.localStorage.getItem(STORAGE_KEY)

  if (!rawState) {
    return createInitialState()
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<GameState>
    const pages = Array.isArray(parsedState.pages) && parsedState.pages.length > 0
      ? parsedState.pages.map((page) => ({
          id: page.id ?? createId(),
          personName: page.personName ?? '',
          header: page.header ?? '',
          description: page.description ?? '',
          photoUrls: Array.isArray(page.photoUrls)
            ? Array.from({ length: PHOTO_COUNT }, (_, index) => page.photoUrls[index] ?? '')
            : Array.from({ length: PHOTO_COUNT }, () => ''),
        }))
      : [createEmptyPage()]

    const players = Array.isArray(parsedState.players)
      ? parsedState.players.map((player) => ({
          id: player.id ?? createId(),
          name: player.name ?? '',
          guesses: player.guesses ?? {},
        }))
      : []

    const presenterIndex = Number.isInteger(parsedState.presenterIndex)
      ? Math.min(Math.max(parsedState.presenterIndex ?? 0, 0), pages.length - 1)
      : 0

    const activePlayerId = players.some((player) => player.id === parsedState.activePlayerId)
      ? parsedState.activePlayerId ?? null
      : players[0]?.id ?? null

    return {
      stage:
        parsedState.stage === 'playing' || parsedState.stage === 'finished'
          ? parsedState.stage
          : 'setup',
      pages,
      players,
      presenterIndex,
      activePlayerId,
    }
  } catch {
    return createInitialState()
  }
}

function normalizeGuess(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function isValidPhotoUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function getPageErrors(page: PersonPage) {
  const errors: string[] = []

  if (!page.personName.trim()) {
    errors.push('Person name is required.')
  }

  page.photoUrls.forEach((photoUrl, index) => {
    if (!photoUrl.trim()) {
      errors.push(`Photo link ${index + 1} is required.`)
      return
    }

    if (!isValidPhotoUrl(photoUrl.trim())) {
      errors.push(`Photo link ${index + 1} must be a valid http or https URL.`)
    }
  })

  return errors
}

function App() {
  const [mode, setMode] = useState<Mode>('creator')
  const [gameState, setGameState] = useState<GameState>(() => parseStoredState())
  const [newPlayerName, setNewPlayerName] = useState('')

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState))
  }, [gameState])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) {
        return
      }

      try {
        const parsedState = JSON.parse(event.newValue) as GameState
        setGameState(parseStoredStateFromEvent(parsedState))
      } catch {
        // Ignore invalid external updates.
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const pageErrors = useMemo(
    () => gameState.pages.map((page) => ({ id: page.id, errors: getPageErrors(page) })),
    [gameState.pages],
  )

  const canStartGame =
    gameState.pages.length > 0 &&
    pageErrors.every((pageError) => pageError.errors.length === 0)

  const activePlayer =
    gameState.players.find((player) => player.id === gameState.activePlayerId) ?? null

  const visiblePlayerPages =
    gameState.stage === 'playing'
      ? gameState.pages.slice(0, gameState.presenterIndex + 1)
      : gameState.stage === 'finished'
        ? gameState.pages
        : []

  const leaderboard = useMemo(() => {
    return [...gameState.players]
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: gameState.pages.reduce((total, page) => {
          return normalizeGuess(player.guesses[page.id] ?? '') === normalizeGuess(page.personName)
            ? total + 1
            : total
        }, 0),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }

        return left.name.localeCompare(right.name)
      })
  }, [gameState.pages, gameState.players])

  const currentPresenterPage = gameState.pages[gameState.presenterIndex] ?? gameState.pages[0]

  function updatePage(pageId: string, updater: (page: PersonPage) => PersonPage) {
    setGameState((currentState) => ({
      ...currentState,
      pages: currentState.pages.map((page) => (page.id === pageId ? updater(page) : page)),
    }))
  }

  function addPage() {
    setGameState((currentState) => {
      if (currentState.pages.length >= MAX_PARTICIPANTS) {
        return currentState
      }

      return {
        ...currentState,
        pages: [...currentState.pages, createEmptyPage()],
      }
    })
  }

  function removePage(pageId: string) {
    setGameState((currentState) => {
      if (currentState.pages.length === 1) {
        return {
          ...currentState,
          pages: [createEmptyPage()],
          presenterIndex: 0,
          players: currentState.players.map((player) => ({
            ...player,
            guesses: {},
          })),
        }
      }

      const remainingPages = currentState.pages.filter((page) => page.id !== pageId)

      return {
        ...currentState,
        pages: remainingPages,
        presenterIndex: Math.min(currentState.presenterIndex, remainingPages.length - 1),
        players: currentState.players.map((player) => {
          const nextGuesses = { ...player.guesses }
          delete nextGuesses[pageId]
          return {
            ...player,
            guesses: nextGuesses,
          }
        }),
      }
    })
  }

  function addPlayer() {
    const trimmedName = newPlayerName.trim()

    if (!trimmedName) {
      return
    }

    setGameState((currentState) => {
      if (currentState.players.length >= MAX_PARTICIPANTS) {
        return currentState
      }

      const normalizedName = normalizeGuess(trimmedName)
      const existingPlayer = currentState.players.find(
        (player) => normalizeGuess(player.name) === normalizedName,
      )

      if (existingPlayer) {
        return {
          ...currentState,
          activePlayerId: existingPlayer.id,
        }
      }

      const newPlayer: Player = {
        id: createId(),
        name: trimmedName,
        guesses: {},
      }

      return {
        ...currentState,
        players: [...currentState.players, newPlayer],
        activePlayerId: newPlayer.id,
      }
    })

    setNewPlayerName('')
  }

  function removePlayer(playerId: string) {
    setGameState((currentState) => {
      const remainingPlayers = currentState.players.filter((player) => player.id !== playerId)
      return {
        ...currentState,
        players: remainingPlayers,
        activePlayerId:
          currentState.activePlayerId === playerId
            ? remainingPlayers[0]?.id ?? null
            : currentState.activePlayerId,
      }
    })
  }

  function updateGuess(pageId: string, guess: string) {
    if (!activePlayer) {
      return
    }

    setGameState((currentState) => ({
      ...currentState,
      players: currentState.players.map((player) =>
        player.id === currentState.activePlayerId
          ? {
              ...player,
              guesses: {
                ...player.guesses,
                [pageId]: guess,
              },
            }
          : player,
      ),
    }))
  }

  function startGame() {
    if (!canStartGame) {
      return
    }

    setGameState((currentState) => ({
      ...currentState,
      stage: 'playing',
      presenterIndex: 0,
      players: currentState.players.map((player) => ({
        ...player,
        guesses: {},
      })),
    }))
  }

  function resetRound() {
    setGameState((currentState) => ({
      ...currentState,
      stage: 'setup',
      presenterIndex: 0,
      players: currentState.players.map((player) => ({
        ...player,
        guesses: {},
      })),
    }))
  }

  function resetAll() {
    setGameState(createInitialState())
    setMode('creator')
  }

  function endGame() {
    setGameState((currentState) => ({
      ...currentState,
      stage: 'finished',
      presenterIndex: Math.max(currentState.pages.length - 1, 0),
    }))
  }

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">Photo Guessing</p>
          <h1>Match the photos to the right person.</h1>
          <p className="hero-copy">
            Create one page per person, present the pages one by one, let players submit
            guesses, and reveal the leaderboard at the end.
          </p>
        </div>
        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">Game status</span>
            <strong>{labelForStage(gameState.stage)}</strong>
          </div>
          <div className="status-card">
            <span className="status-label">Pages</span>
            <strong>{gameState.pages.length}</strong>
          </div>
          <div className="status-card">
            <span className="status-label">Players</span>
            <strong>{gameState.players.length}</strong>
          </div>
        </div>
      </header>

      <section className="toolbar">
        <div className="mode-picker" role="tablist" aria-label="Choose a mode">
          {(['creator', 'presenter', 'player'] as Mode[]).map((modeOption) => (
            <button
              key={modeOption}
              type="button"
              className={mode === modeOption ? 'mode-button active' : 'mode-button'}
              onClick={() => setMode(modeOption)}
            >
              {labelForMode(modeOption)}
            </button>
          ))}
        </div>
        <p className="sync-note">
          Shared state is stored in this browser and synced across open tabs with local
          storage.
        </p>
      </section>

      <main className="main-grid">
        {mode === 'creator' && (
          <>
            <section className="panel stack-gap">
              <div className="panel-header">
                <div>
                  <h2>Create person pages</h2>
                  <p>Add up to {MAX_PARTICIPANTS} pages, each with exactly three photo links.</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={addPage}
                  disabled={gameState.pages.length >= MAX_PARTICIPANTS}
                >
                  Add page
                </button>
              </div>

              <div className="stack-gap">
                {gameState.pages.map((page, index) => {
                  const errors = pageErrors.find((pageError) => pageError.id === page.id)?.errors ?? []

                  return (
                    <article key={page.id} className="editor-card">
                      <div className="panel-header compact">
                        <h3>Page {index + 1}</h3>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => removePage(page.id)}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="form-grid">
                        <label>
                          <span>Correct person name</span>
                          <input
                            value={page.personName}
                            onChange={(event) =>
                              updatePage(page.id, (currentPage) => ({
                                ...currentPage,
                                personName: event.currentTarget.value,
                              }))
                            }
                            placeholder="e.g. Alex"
                          />
                        </label>
                        <label>
                          <span>Optional page header</span>
                          <input
                            value={page.header}
                            onChange={(event) =>
                              updatePage(page.id, (currentPage) => ({
                                ...currentPage,
                                header: event.currentTarget.value,
                              }))
                            }
                            placeholder="Optional title"
                          />
                        </label>
                      </div>

                      <label>
                        <span>Optional description</span>
                        <textarea
                          value={page.description}
                          onChange={(event) =>
                            updatePage(page.id, (currentPage) => ({
                              ...currentPage,
                              description: event.currentTarget.value,
                            }))
                          }
                          rows={3}
                          placeholder="Optional intro text or clue"
                        />
                      </label>

                      <div className="form-grid">
                        {page.photoUrls.map((photoUrl, photoIndex) => (
                          <label key={`${page.id}-photo-${photoIndex}`}>
                            <span>Photo link {photoIndex + 1}</span>
                            <input
                              value={photoUrl}
                              onChange={(event) =>
                                updatePage(page.id, (currentPage) => ({
                                  ...currentPage,
                                  photoUrls: currentPage.photoUrls.map((value, currentIndex) =>
                                    currentIndex === photoIndex ? event.currentTarget.value : value,
                                  ),
                                }))
                              }
                              placeholder="https://..."
                            />
                          </label>
                        ))}
                      </div>

                      {errors.length > 0 && (
                        <ul className="error-list">
                          {errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>

            <aside className="panel stack-gap">
              <div className="panel-header compact">
                <h2>Round controls</h2>
              </div>
              <div className="button-group vertical">
                <button type="button" className="primary-button" onClick={startGame} disabled={!canStartGame}>
                  Start game
                </button>
                <button type="button" className="secondary-button" onClick={resetRound}>
                  Reset guesses
                </button>
                <button type="button" className="ghost-button" onClick={resetAll}>
                  Clear all data
                </button>
              </div>
              <p className="helper-text">
                Starting a new game keeps the pages and player list, but clears every stored
                guess.
              </p>

              <div className="divider"></div>

              <div className="panel-header compact">
                <h2>Players</h2>
              </div>
              <div className="join-grid">
                <input
                  value={newPlayerName}
                  onChange={(event) => setNewPlayerName(event.currentTarget.value)}
                  placeholder="Add or join a player"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={addPlayer}
                  disabled={gameState.players.length >= MAX_PARTICIPANTS}
                >
                  Save player
                </button>
              </div>
              {gameState.players.length === 0 ? (
                <p className="helper-text">No players have joined yet.</p>
              ) : (
                <ul className="people-list">
                  {gameState.players.map((player) => (
                    <li key={player.id}>
                      <span>{player.name}</span>
                      <button type="button" className="ghost-button" onClick={() => removePlayer(player.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </>
        )}

        {mode === 'presenter' && currentPresenterPage && (
          <>
            <section className="panel stack-gap">
              <div className="panel-header">
                <div>
                  <h2>Presenter view</h2>
                  <p>
                    Page {Math.min(gameState.presenterIndex + 1, gameState.pages.length)} of{' '}
                    {gameState.pages.length}
                  </p>
                </div>
                <span className="stage-pill">{labelForStage(gameState.stage)}</span>
              </div>

              {gameState.stage === 'setup' && (
                <p className="helper-text">
                  Start the game from Creator mode once all page validation errors are fixed.
                </p>
              )}

              <PagePreview page={currentPresenterPage} revealAnswer={gameState.stage === 'finished'} />

              <div className="button-group wrap">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setGameState((currentState) => ({
                      ...currentState,
                      presenterIndex: Math.max(currentState.presenterIndex - 1, 0),
                    }))
                  }
                  disabled={gameState.presenterIndex === 0}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setGameState((currentState) => ({
                      ...currentState,
                      presenterIndex: Math.min(
                        currentState.presenterIndex + 1,
                        currentState.pages.length - 1,
                      ),
                    }))
                  }
                  disabled={gameState.presenterIndex >= gameState.pages.length - 1}
                >
                  Next page
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={endGame}
                  disabled={gameState.stage !== 'playing'}
                >
                  End game
                </button>
              </div>
            </section>

            <aside className="panel stack-gap">
              <div className="panel-header compact">
                <h2>Leaderboard</h2>
              </div>
              {gameState.stage === 'finished' ? (
                <Leaderboard rows={leaderboard} totalPages={gameState.pages.length} />
              ) : (
                <p className="helper-text">
                  Scores stay hidden until the presenter ends the game.
                </p>
              )}
            </aside>
          </>
        )}

        {mode === 'player' && (
          <>
            <section className="panel stack-gap">
              <div className="panel-header">
                <div>
                  <h2>Player view</h2>
                  <p>Choose your name, then enter guesses as pages are presented.</p>
                </div>
                <span className="stage-pill">{labelForStage(gameState.stage)}</span>
              </div>

              <div className="join-grid stacked-mobile">
                <select
                  value={gameState.activePlayerId ?? ''}
                  onChange={(event) =>
                    setGameState((currentState) => ({
                      ...currentState,
                      activePlayerId: event.currentTarget.value || null,
                    }))
                  }
                >
                  <option value="">Choose a saved player</option>
                  {gameState.players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
                <input
                  value={newPlayerName}
                  onChange={(event) => setNewPlayerName(event.currentTarget.value)}
                  placeholder="Or add a new player"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={addPlayer}
                  disabled={gameState.players.length >= MAX_PARTICIPANTS}
                >
                  Join
                </button>
              </div>

              {!activePlayer && (
                <p className="helper-text">
                  Pick an existing player or add a new name to start entering guesses.
                </p>
              )}

              {activePlayer && gameState.stage === 'setup' && (
                <p className="helper-text">
                  Waiting for the presenter to start the game. Your guesses will stay hidden until
                  the round ends.
                </p>
              )}

              {activePlayer && visiblePlayerPages.length > 0 && (
                <div className="stack-gap">
                  {visiblePlayerPages.map((page, index) => {
                    const guess = activePlayer.guesses[page.id] ?? ''
                    const correct = normalizeGuess(guess) === normalizeGuess(page.personName)

                    return (
                      <article key={page.id} className="guess-card">
                        <div className="panel-header compact">
                          <h3>Page {index + 1}</h3>
                          {gameState.stage === 'finished' && (
                            <span className={correct ? 'answer-pill correct' : 'answer-pill incorrect'}>
                              {correct ? 'Correct' : 'Incorrect'}
                            </span>
                          )}
                        </div>
                        <PagePreview page={page} revealAnswer={gameState.stage === 'finished'} />
                        <label>
                          <span>Your guess</span>
                          <input
                            value={guess}
                            onChange={(event) => updateGuess(page.id, event.currentTarget.value)}
                            placeholder="Type the person's name"
                            disabled={gameState.stage === 'finished'}
                          />
                        </label>
                        {gameState.stage === 'finished' && (
                          <p className="helper-text">
                            Correct answer: <strong>{page.personName}</strong>
                          </p>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}

              {activePlayer && gameState.stage === 'playing' && visiblePlayerPages.length === 0 && (
                <p className="helper-text">The presenter has not shown the first page yet.</p>
              )}
            </section>

            <aside className="panel stack-gap">
              <div className="panel-header compact">
                <h2>Your standing</h2>
              </div>
              {gameState.stage === 'finished' && activePlayer ? (
                <>
                  <p className="score-highlight">
                    {activePlayer.name} scored{' '}
                    <strong>
                      {leaderboard.find((row) => row.id === activePlayer.id)?.score ?? 0} /{' '}
                      {gameState.pages.length}
                    </strong>
                  </p>
                  <Leaderboard rows={leaderboard} totalPages={gameState.pages.length} />
                </>
              ) : (
                <p className="helper-text">
                  The leaderboard is revealed only after the presenter ends the game.
                </p>
              )}
            </aside>
          </>
        )}
      </main>
    </div>
  )
}

type PagePreviewProps = {
  page: PersonPage
  revealAnswer: boolean
}

function PagePreview({ page, revealAnswer }: PagePreviewProps) {
  return (
    <div className="preview-card">
      <div className="panel-header compact">
        <div>
          <h3>{page.header.trim() || 'Photo round'}</h3>
          {page.description.trim() && <p>{page.description}</p>}
        </div>
        <span className="answer-pill muted">
          {revealAnswer ? page.personName || 'Unnamed person' : 'Identity hidden'}
        </span>
      </div>
      <div className="photo-grid">
        {page.photoUrls.map((photoUrl, index) => (
          <div key={`${page.id}-${index}`} className="photo-frame">
            {photoUrl.trim() ? (
              <img src={photoUrl.trim()} alt={`Photo ${index + 1}`} />
            ) : (
              <div className="placeholder-photo">Photo {index + 1}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

type LeaderboardProps = {
  rows: Array<{
    id: string
    name: string
    score: number
  }>
  totalPages: number
}

function Leaderboard({ rows, totalPages }: LeaderboardProps) {
  if (rows.length === 0) {
    return <p className="helper-text">No players joined this round.</p>
  }

  return (
    <ol className="leaderboard">
      {rows.map((row, index) => (
        <li key={row.id}>
          <span>
            {index + 1}. {row.name}
          </span>
          <strong>
            {row.score} / {totalPages}
          </strong>
        </li>
      ))}
    </ol>
  )
}

function labelForMode(mode: Mode) {
  if (mode === 'creator') {
    return 'Creator'
  }

  if (mode === 'presenter') {
    return 'Presenter'
  }

  return 'Player'
}

function labelForStage(stage: GameStage) {
  if (stage === 'setup') {
    return 'Setup'
  }

  if (stage === 'playing') {
    return 'Live round'
  }

  return 'Finished'
}

function parseStoredStateFromEvent(state: GameState): GameState {
  const pages = state.pages.length > 0 ? state.pages : [createEmptyPage()]
  const players = state.players ?? []

  return {
    stage: state.stage,
    pages: pages.map((page) => ({
      ...page,
      photoUrls: Array.from({ length: PHOTO_COUNT }, (_, index) => page.photoUrls[index] ?? ''),
    })),
    players,
    presenterIndex: Math.min(Math.max(state.presenterIndex, 0), pages.length - 1),
    activePlayerId: players.some((player) => player.id === state.activePlayerId)
      ? state.activePlayerId
      : players[0]?.id ?? null,
  }
}

export default App
