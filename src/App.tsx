import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import './App.css'
import { auth, db, ensurePlayerAuth, firebaseConfigReady, missingFirebaseEnvKeys, signInWithGoogle, signOutCurrentUser } from './lib/firebase'
import {
  MAX_PLAYERS,
  cloneGameRecord,
  coerceGameRecord,
  coercePlayerRecord,
  createEmptyPage,
  createGameCode,
  formatStatus,
  normalizeText,
  sanitizePages,
  scorePlayer,
  sortPlayersByScore,
  type GameRecord,
  type GameStatus,
  type PersonPage,
  type PlayerRecord,
} from './lib/game'

type AppMode = 'player' | 'admin'

type PlayerSession = {
  code: string
  gameId: string
  playerId: string
  displayName: string
}

const PLAYER_SESSION_KEY = 'photoguessing-player-session'

function loadPlayerSession(): PlayerSession | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.localStorage.getItem(PLAYER_SESSION_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<PlayerSession>

    if (!parsedValue.gameId || !parsedValue.playerId || !parsedValue.code || !parsedValue.displayName) {
      return null
    }

    return {
      gameId: parsedValue.gameId,
      playerId: parsedValue.playerId,
      code: parsedValue.code,
      displayName: parsedValue.displayName,
    }
  } catch {
    return null
  }
}

function persistPlayerSession(session: PlayerSession | null) {
  if (typeof window === 'undefined') {
    return
  }

  if (!session) {
    window.localStorage.removeItem(PLAYER_SESSION_KEY)
    return
  }

  window.localStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(session))
}

function sortGames(games: GameRecord[]) {
  return [...games].sort((left, right) => right.updatedAtMs - left.updatedAtMs)
}

function buildGamePayload(game: GameRecord, overrides: Partial<GameRecord> = {}) {
  const pages = sanitizePages(game.pages)
  const merged = {
    ...game,
    ...overrides,
  }

  return {
    title: merged.title.trim(),
    code: merged.code.trim().toUpperCase(),
    status: merged.status,
    activePageIndex: Math.min(Math.max(merged.activePageIndex, 0), Math.max(pages.length - 1, 0)),
    pages,
    createdBy: merged.createdBy,
    createdAtMs: merged.createdAtMs,
    updatedAtMs: Date.now(),
  }
}

async function generateUniqueGameCode() {
  if (!db) {
    throw new Error('Firebase is not configured yet.')
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = createGameCode()
    const existingGames = await getDocs(query(collection(db, 'games'), where('code', '==', candidate), limit(1)))

    if (existingGames.empty) {
      return candidate
    }
  }

  throw new Error('Could not generate a unique join code. Please try again.')
}

function App() {
  const [mode, setMode] = useState<AppMode>('player')
  const [authReady, setAuthReady] = useState(!auth)
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null)
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)

  const [games, setGames] = useState<GameRecord[]>([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [editorGame, setEditorGame] = useState<GameRecord | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [adminMessage, setAdminMessage] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [selectedGamePlayers, setSelectedGamePlayers] = useState<PlayerRecord[]>([])

  const [playerSession, setPlayerSession] = useState<PlayerSession | null>(() => loadPlayerSession())
  const [joinedGame, setJoinedGame] = useState<GameRecord | null>(null)
  const [joinedPlayers, setJoinedPlayers] = useState<PlayerRecord[]>([])
  const [joinCode, setJoinCode] = useState(() => loadPlayerSession()?.code ?? '')
  const [displayName, setDisplayName] = useState(() => loadPlayerSession()?.displayName ?? '')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [joinMessage, setJoinMessage] = useState('')
  const [currentGuess, setCurrentGuess] = useState('')
  const [guessSaveMessage, setGuessSaveMessage] = useState('')
  const [guessError, setGuessError] = useState('')

  useEffect(() => {
    if (!auth) {
      setAuthReady(true)
      return undefined
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthReady(true)
    })
  }, [])

  useEffect(() => {
    persistPlayerSession(playerSession)
  }, [playerSession])

  const isAdminUser = Boolean(user && !user.isAnonymous)

  useEffect(() => {
    if (!db || !isAdminUser || !user) {
      setGames([])
      return undefined
    }

    const gamesQuery = query(collection(db, 'games'), where('createdBy', '==', user.uid))
    return onSnapshot(gamesQuery, (snapshot) => {
      const nextGames = sortGames(snapshot.docs.map((entry) => coerceGameRecord(entry.id, entry.data())))
      setGames(nextGames)
    })
  }, [isAdminUser, user])

  useEffect(() => {
    if (games.length === 0) {
      setSelectedGameId('')
      return
    }

    setSelectedGameId((currentValue) => {
      if (currentValue && games.some((game) => game.id === currentValue)) {
        return currentValue
      }

      return games[0]!.id
    })
  }, [games])

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId],
  )

  useEffect(() => {
    if (!selectedGame) {
      setEditorGame(null)
      setEditorDirty(false)
      return
    }

    setEditorGame(cloneGameRecord(selectedGame))
    setEditorDirty(false)
  }, [selectedGame])

  useEffect(() => {
    if (!db || !selectedGameId || !isAdminUser) {
      setSelectedGamePlayers([])
      return undefined
    }

    return onSnapshot(collection(db, 'games', selectedGameId, 'players'), (snapshot) => {
      const nextPlayers = snapshot.docs.map((entry) => coercePlayerRecord(entry.id, entry.data()))
      setSelectedGamePlayers(nextPlayers)
    })
  }, [isAdminUser, selectedGameId])

  useEffect(() => {
    if (!db || !playerSession?.gameId) {
      setJoinedGame(null)
      setJoinedPlayers([])
      return undefined
    }

    const gameRef = doc(db, 'games', playerSession.gameId)
    const unsubscribeGame = onSnapshot(gameRef, (snapshot) => {
      if (!snapshot.exists()) {
        setJoinedGame(null)
        setJoinedPlayers([])
        setPlayerSession(null)
        setJoinMessage('That game is no longer available.')
        return
      }

      setJoinedGame(coerceGameRecord(snapshot.id, snapshot.data()))
    })

    const unsubscribePlayers = onSnapshot(collection(db, 'games', playerSession.gameId, 'players'), (snapshot) => {
      const nextPlayers = snapshot.docs.map((entry) => coercePlayerRecord(entry.id, entry.data()))
      setJoinedPlayers(nextPlayers)
    })

    return () => {
      unsubscribeGame()
      unsubscribePlayers()
    }
  }, [playerSession?.gameId])

  const joinedPlayer = useMemo(() => {
    if (!playerSession) {
      return null
    }

    return joinedPlayers.find((player) => player.id === playerSession.playerId) ?? null
  }, [joinedPlayers, playerSession])

  const activeJoinedPage = useMemo(() => {
    if (!joinedGame || joinedGame.status !== 'live') {
      return null
    }

    return joinedGame.pages[joinedGame.activePageIndex] ?? null
  }, [joinedGame])

  const savedGuess = activeJoinedPage && joinedPlayer ? joinedPlayer.guesses[activeJoinedPage.id] ?? '' : ''

  useEffect(() => {
    setCurrentGuess(savedGuess)
  }, [savedGuess, activeJoinedPage?.id])

  useEffect(() => {
    if (!db || !playerSession || !joinedGame || joinedGame.status !== 'live' || !activeJoinedPage) {
      return undefined
    }

    if (currentGuess === savedGuess) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      updateDoc(doc(db, 'games', playerSession.gameId, 'players', playerSession.playerId), {
        [`guesses.${activeJoinedPage.id}`]: currentGuess,
        updatedAtMs: Date.now(),
      })
        .then(() => {
          setGuessSaveMessage('Guess saved.')
          setGuessError('')
        })
        .catch((error: unknown) => {
          setGuessError(error instanceof Error ? error.message : 'Could not save the guess.')
        })
    }, 500)

    return () => window.clearTimeout(timeoutId)
  }, [activeJoinedPage, currentGuess, joinedGame, playerSession, savedGuess])

  useEffect(() => {
    if (!guessSaveMessage) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => setGuessSaveMessage(''), 1500)
    return () => window.clearTimeout(timeoutId)
  }, [guessSaveMessage])

  const editorErrors = useMemo(() => (editorGame ? [] : []), [editorGame])

  const adminLeaderboard = useMemo(() => {
    if (!selectedGame) {
      return []
    }

    return sortPlayersByScore(selectedGamePlayers, selectedGame.pages)
  }, [selectedGame, selectedGamePlayers])

  const playerLeaderboard = useMemo(() => {
    if (!joinedGame) {
      return []
    }

    return sortPlayersByScore(joinedPlayers, joinedGame.pages)
  }, [joinedGame, joinedPlayers])

  async function handleGoogleSignIn() {
    setAuthBusy(true)
    setAuthError('')

    try {
      await signInWithGoogle()
      setMode('admin')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign in with Google.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    setAuthBusy(true)
    setAuthError('')

    try {
      await signOutCurrentUser()
      setMode('player')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign out.')
    } finally {
      setAuthBusy(false)
    }
  }

  function updateEditor(updater: (currentGame: GameRecord) => GameRecord) {
    setEditorGame((currentGame) => {
      if (!currentGame) {
        return currentGame
      }

      setEditorDirty(true)
      setAdminMessage('')
      setAdminError('')
      return updater(currentGame)
    })
  }

  function updateEditorPage(pageId: string, updater: (page: PersonPage) => PersonPage) {
    updateEditor((currentGame) => ({
      ...currentGame,
      pages: currentGame.pages.map((page) => (page.id === pageId ? updater(page) : page)),
    }))
  }

  async function createGame() {
    if (!db || !user) {
      return
    }

    setAdminBusy(true)
    setAdminError('')
    setAdminMessage('')

    try {
      const code = await generateUniqueGameCode()
      const now = Date.now()
      const newGame = {
        title: 'Untitled game',
        code,
        status: 'draft' as GameStatus,
        activePageIndex: 0,
        pages: [createEmptyPage()],
        createdBy: user.uid,
        createdAtMs: now,
        updatedAtMs: now,
      }
      const createdGame = await addDoc(collection(db, 'games'), newGame)
      setSelectedGameId(createdGame.id)
      setMode('admin')
      setAdminMessage(`Created game ${code}.`)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Could not create the game.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function saveEditorGame(options: { validate: boolean; status?: GameStatus; activePageIndex?: number; message: string }) {
    if (!db || !selectedGame || !editorGame) {
      return false
    }

    if (options.validate) {
      const validationErrors = buildValidationErrors(editorGame)
      if (validationErrors.length > 0) {
        setAdminError(validationErrors[0]!)
        return false
      }
    }

    setAdminBusy(true)
    setAdminError('')
    setAdminMessage('')

    try {
      const payload = buildGamePayload(editorGame, {
        status: options.status ?? editorGame.status,
        activePageIndex: options.activePageIndex ?? editorGame.activePageIndex,
      })
      await updateDoc(doc(db, 'games', selectedGame.id), payload)
      setAdminMessage(options.message)
      setEditorDirty(false)
      return true
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Could not save the game.')
      return false
    } finally {
      setAdminBusy(false)
    }
  }

  async function deleteSelectedGame() {
    if (!db || !selectedGame) {
      return
    }

    const confirmed = window.confirm(`Delete game ${selectedGame.code}? This also removes joined players for that game.`)
    if (!confirmed) {
      return
    }

    setAdminBusy(true)
    setAdminError('')
    setAdminMessage('')

    try {
      const batch = writeBatch(db)
      const playersSnapshot = await getDocs(collection(db, 'games', selectedGame.id, 'players'))
      playersSnapshot.docs.forEach((entry) => batch.delete(entry.ref))
      batch.delete(doc(db, 'games', selectedGame.id))
      await batch.commit()
      setAdminMessage(`Deleted game ${selectedGame.code}.`)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Could not delete the game.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function movePresenterPage(direction: -1 | 1) {
    if (!db || !selectedGame) {
      return
    }

    const nextIndex = Math.min(
      Math.max(selectedGame.activePageIndex + direction, 0),
      Math.max(selectedGame.pages.length - 1, 0),
    )

    if (nextIndex === selectedGame.activePageIndex) {
      return
    }

    setAdminBusy(true)
    setAdminError('')

    try {
      await updateDoc(doc(db, 'games', selectedGame.id), {
        activePageIndex: nextIndex,
        updatedAtMs: Date.now(),
      })
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Could not move to the next page.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function finishSelectedGame() {
    await saveEditorGame({
      validate: true,
      status: 'finished',
      message: 'Game finished. Players can now see the leaderboard and answers.',
    })
  }

  async function publishSelectedGame() {
    await saveEditorGame({
      validate: true,
      status: 'published',
      activePageIndex: 0,
      message: 'Game published. Players can now join with the code.',
    })
  }

  async function startSelectedGame() {
    await saveEditorGame({
      validate: true,
      status: 'live',
      activePageIndex: 0,
      message: 'Game is live. Presenter controls are active.',
    })
  }

  async function returnGameToDraft() {
    await saveEditorGame({
      validate: false,
      status: 'draft',
      activePageIndex: 0,
      message: 'Game moved back to draft.',
    })
  }

  async function handleJoinGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!db) {
      return
    }

    const normalizedCode = joinCode.trim().toUpperCase()
    const trimmedDisplayName = displayName.trim()

    if (!normalizedCode) {
      setJoinError('Enter the 5-character game code.')
      return
    }

    if (!trimmedDisplayName) {
      setJoinError('Enter your display name.')
      return
    }

    setJoinBusy(true)
    setJoinError('')
    setJoinMessage('')

    try {
      const matchingGames = await getDocs(query(collection(db, 'games'), where('code', '==', normalizedCode), limit(1)))
      if (matchingGames.empty) {
        throw new Error('No game was found for that code.')
      }

      const gameSnapshot = matchingGames.docs[0]!
      const game = coerceGameRecord(gameSnapshot.id, gameSnapshot.data())

      if (game.status === 'draft') {
        throw new Error('That game is still in draft mode and cannot be joined yet.')
      }

      const playerUser = await ensurePlayerAuth()
      const normalizedName = normalizeText(trimmedDisplayName)
      const playersRef = collection(db, 'games', game.id, 'players')
      const playerRef = doc(playersRef, playerUser.uid)

      const [existingPlayer, matchingNamePlayers, allPlayers] = await Promise.all([
        getDoc(playerRef),
        getDocs(query(playersRef, where('normalizedName', '==', normalizedName), limit(1))),
        getDocs(playersRef),
      ])

      if (!existingPlayer.exists() && allPlayers.size >= MAX_PLAYERS) {
        throw new Error('This game already has the maximum of 20 players.')
      }

      const duplicateName = matchingNamePlayers.docs.find((entry) => entry.id !== playerUser.uid)
      if (duplicateName) {
        throw new Error('That display name is already taken in this game.')
      }

      const now = Date.now()
      const existingData = existingPlayer.exists() ? coercePlayerRecord(existingPlayer.id, existingPlayer.data()) : null

      await setDoc(
        playerRef,
        {
          displayName: trimmedDisplayName,
          normalizedName,
          guesses: existingData?.guesses ?? {},
          joinedAtMs: existingData?.joinedAtMs ?? now,
          updatedAtMs: now,
        },
        { merge: true },
      )

      setPlayerSession({
        code: normalizedCode,
        gameId: game.id,
        playerId: playerUser.uid,
        displayName: trimmedDisplayName,
      })
      setJoinCode(normalizedCode)
      setDisplayName(trimmedDisplayName)
      setMode('player')
      setJoinMessage(`Joined ${game.title}.`) 
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Could not join the game.')
    } finally {
      setJoinBusy(false)
    }
  }

  function leaveJoinedGame() {
    setPlayerSession(null)
    setJoinedGame(null)
    setJoinedPlayers([])
    setCurrentGuess('')
    setGuessError('')
    setGuessSaveMessage('')
    setJoinMessage('You left the current game on this device.')
  }

  const playerRank = playerLeaderboard.findIndex((player) => player.id === playerSession?.playerId)

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Photo Guessing</p>
          <h1>Guess the person from three photos.</h1>
          <p className="lede">
            Creator and Presenter share one Google-authenticated workspace. Players join with a simple code, follow the live page, and see the final leaderboard only when the presenter finishes the game.
          </p>
        </div>
        <div className="hero-actions">
          <button
            className={mode === 'player' ? 'chip-button active' : 'chip-button'}
            type="button"
            onClick={() => setMode('player')}
          >
            Player
          </button>
          <button
            className={mode === 'admin' ? 'chip-button active' : 'chip-button'}
            type="button"
            onClick={() => setMode('admin')}
          >
            Creator / Presenter
          </button>
        </div>
      </header>

      {!firebaseConfigReady ? (
        <section className="panel notice-panel">
          <h2>Firebase setup required</h2>
          <p>Add the missing Vite environment variables before using the app:</p>
          <ul className="bullet-list">
            {missingFirebaseEnvKeys.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
          <p>See /home/runner/work/photoguessing/photoguessing/readme.md for local setup, GitHub Pages secrets, and Firestore rules.</p>
        </section>
      ) : null}

      <section className="status-grid">
        <article className="status-card">
          <span className="status-label">Your access</span>
          <strong>{isAdminUser ? 'Creator / Presenter' : playerSession ? 'Joined player' : 'Guest'}</strong>
        </article>
        <article className="status-card">
          <span className="status-label">Saved games</span>
          <strong>{games.length}</strong>
        </article>
        <article className="status-card">
          <span className="status-label">Joined players</span>
          <strong>{joinedPlayers.length || selectedGamePlayers.length}</strong>
        </article>
      </section>

      {mode === 'admin' ? (
        <section className="main-grid">
          <aside className="panel stack-gap">
            <div className="panel-header">
              <div>
                <h2>Creator / Presenter</h2>
                <p>Sign in with Google to create, publish, and present your games.</p>
              </div>
              {isAdminUser ? (
                <button className="secondary-button" type="button" disabled={authBusy} onClick={handleSignOut}>
                  Sign out
                </button>
              ) : null}
            </div>

            {!authReady ? <p>Checking sign-in state…</p> : null}
            {!isAdminUser ? (
              <div className="stack-gap">
                <button className="primary-button" type="button" disabled={authBusy || !firebaseConfigReady} onClick={handleGoogleSignIn}>
                  {authBusy ? 'Signing in…' : 'Sign in with Google'}
                </button>
                <p className="helper-text">Players do not need Google sign-in. They can join from the Player tab with a game code.</p>
                {authError ? <p className="error-text">{authError}</p> : null}
              </div>
            ) : (
              <>
                <button className="primary-button" type="button" disabled={adminBusy} onClick={createGame}>
                  {adminBusy ? 'Working…' : 'Create new game'}
                </button>
                <div className="stack-gap">
                  {games.map((game) => (
                    <button
                      key={game.id}
                      className={selectedGameId === game.id ? 'game-list-item active' : 'game-list-item'}
                      type="button"
                      onClick={() => setSelectedGameId(game.id)}
                    >
                      <span>{game.title || 'Untitled game'}</span>
                      <small>{game.code} · {formatStatus(game.status)} · {game.pages.length} pages</small>
                    </button>
                  ))}
                  {games.length === 0 ? <p className="helper-text">No games yet. Create your first one to get started.</p> : null}
                </div>
                {authError ? <p className="error-text">{authError}</p> : null}
                {adminError ? <p className="error-text">{adminError}</p> : null}
                {adminMessage ? <p className="success-text">{adminMessage}</p> : null}
              </>
            )}
          </aside>

          <div className="stack-gap">
            {isAdminUser && editorGame ? (
              <>
                <section className="panel stack-gap">
                  <div className="panel-header compact">
                    <div>
                      <h2>{editorGame.title || 'Untitled game'}</h2>
                      <p>Code: <strong>{editorGame.code}</strong> · Status: <strong>{formatStatus(editorGame.status)}</strong></p>
                    </div>
                    <div className="button-row wrap">
                      <button className="secondary-button" type="button" disabled={adminBusy || !editorDirty} onClick={() => saveEditorGame({ validate: false, message: 'Draft changes saved.' })}>
                        Save draft
                      </button>
                      <button className="secondary-button" type="button" disabled={adminBusy} onClick={publishSelectedGame}>
                        Publish
                      </button>
                      <button className="secondary-button" type="button" disabled={adminBusy} onClick={startSelectedGame}>
                        Start live
                      </button>
                      <button className="secondary-button" type="button" disabled={adminBusy} onClick={finishSelectedGame}>
                        Finish
                      </button>
                      <button className="ghost-button" type="button" disabled={adminBusy} onClick={returnGameToDraft}>
                        Move to draft
                      </button>
                      <button className="ghost-button danger" type="button" disabled={adminBusy} onClick={deleteSelectedGame}>
                        Delete game
                      </button>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label>
                      <span>Game title</span>
                      <input
                        value={editorGame.title}
                        onChange={(event) => updateEditor((currentGame) => ({ ...currentGame, title: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>Join code</span>
                      <input value={editorGame.code} disabled />
                    </label>
                  </div>
                  <p className="helper-text">Drafts can be incomplete. Publish or start the game only after every page has a correct name and three valid photo links.</p>
                  {buildValidationErrors(editorGame).length > 0 ? (
                    <ul className="error-list">
                      {buildValidationErrors(editorGame).map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                <section className="panel stack-gap">
                  <div className="panel-header compact">
                    <div>
                      <h2>Person pages</h2>
                      <p>Each page contains one correct person, optional text, and exactly three photo links.</p>
                    </div>
                    <button className="primary-button" type="button" onClick={() => updateEditor((currentGame) => ({ ...currentGame, pages: [...currentGame.pages, createEmptyPage()] }))}>
                      Add page
                    </button>
                  </div>

                  <div className="stack-gap">
                    {editorGame.pages.map((page, index) => (
                      <article key={page.id} className="editor-card">
                        <div className="panel-header compact">
                          <div>
                            <h3>Page {index + 1}</h3>
                            <p>Correct answer: {page.personName || 'Not set yet'}</p>
                          </div>
                          <div className="button-row wrap">
                            <button className="ghost-button" type="button" disabled={index === 0} onClick={() => movePage(editorGame, page.id, -1, updateEditor)}>
                              Move up
                            </button>
                            <button className="ghost-button" type="button" disabled={index === editorGame.pages.length - 1} onClick={() => movePage(editorGame, page.id, 1, updateEditor)}>
                              Move down
                            </button>
                            <button className="ghost-button danger" type="button" disabled={editorGame.pages.length === 1} onClick={() => updateEditor((currentGame) => ({
                              ...currentGame,
                              pages: currentGame.pages.filter((entry) => entry.id !== page.id),
                              activePageIndex: Math.min(currentGame.activePageIndex, Math.max(currentGame.pages.length - 2, 0)),
                            }))}>
                              Remove page
                            </button>
                          </div>
                        </div>

                        <div className="form-grid">
                          <label>
                            <span>Correct person name</span>
                            <input value={page.personName} onChange={(event) => updateEditorPage(page.id, (currentPage) => ({ ...currentPage, personName: event.target.value }))} />
                          </label>
                          <label>
                            <span>Optional header</span>
                            <input value={page.header} onChange={(event) => updateEditorPage(page.id, (currentPage) => ({ ...currentPage, header: event.target.value }))} />
                          </label>
                        </div>
                        <label>
                          <span>Optional description</span>
                          <textarea value={page.description} onChange={(event) => updateEditorPage(page.id, (currentPage) => ({ ...currentPage, description: event.target.value }))} />
                        </label>
                        <div className="photo-url-grid">
                          {page.photoUrls.map((photoUrl, photoIndex) => (
                            <label key={`${page.id}-${photoIndex}`}>
                              <span>Photo link {photoIndex + 1}</span>
                              <input value={photoUrl} onChange={(event) => updateEditorPage(page.id, (currentPage) => ({
                                ...currentPage,
                                photoUrls: currentPage.photoUrls.map((value, indexValue) => indexValue === photoIndex ? event.target.value : value) as [string, string, string],
                              }))} />
                            </label>
                          ))}
                        </div>
                        <div className="photo-grid">
                          {page.photoUrls.map((photoUrl, photoIndex) => (
                            <div key={`${page.id}-preview-${photoIndex}`} className="photo-frame">
                              {photoUrl.trim() ? <img src={photoUrl} alt={`Preview ${photoIndex + 1} for ${page.personName || `page ${index + 1}`}`} /> : <div className="placeholder-photo">Photo preview {photoIndex + 1}</div>}
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="panel stack-gap">
                  <div className="panel-header compact">
                    <div>
                      <h2>Presenter view</h2>
                      <p>Players always follow the currently active page in real time.</p>
                    </div>
                    <div className="button-row">
                      <button className="secondary-button" type="button" disabled={adminBusy || !selectedGame || selectedGame.activePageIndex === 0 || selectedGame.status !== 'live'} onClick={() => movePresenterPage(-1)}>
                        Previous page
                      </button>
                      <button className="secondary-button" type="button" disabled={adminBusy || !selectedGame || selectedGame.activePageIndex >= selectedGame.pages.length - 1 || selectedGame.status !== 'live'} onClick={() => movePresenterPage(1)}>
                        Next page
                      </button>
                    </div>
                  </div>
                  {selectedGame.status === 'published' ? <p className="helper-text">Players can join now. Start live when you are ready to reveal page 1.</p> : null}
                  {selectedGame.status === 'finished' ? <p className="helper-text">The game is finished. Players can see the leaderboard and the correct answers.</p> : null}
                  {selectedGame.pages[selectedGame.activePageIndex] ? (
                    <div className="preview-card">
                      <p className="eyebrow">Active page {selectedGame.activePageIndex + 1} / {selectedGame.pages.length}</p>
                      <h3>{selectedGame.pages[selectedGame.activePageIndex]!.header || 'No header set'}</h3>
                      <p>{selectedGame.pages[selectedGame.activePageIndex]!.description || 'No description set.'}</p>
                      <div className="photo-grid">
                        {selectedGame.pages[selectedGame.activePageIndex]!.photoUrls.map((photoUrl, photoIndex) => (
                          <div key={`${selectedGame.pages[selectedGame.activePageIndex]!.id}-${photoIndex}`} className="photo-frame">
                            {photoUrl.trim() ? <img src={photoUrl} alt={`Presenter preview ${photoIndex + 1}`} /> : <div className="placeholder-photo">Missing photo {photoIndex + 1}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="panel stack-gap">
                  <div className="panel-header compact">
                    <div>
                      <h2>Players</h2>
                      <p>{selectedGamePlayers.length} / {MAX_PLAYERS} players joined this game.</p>
                    </div>
                  </div>
                  <ul className="people-list">
                    {selectedGamePlayers.map((player) => (
                      <li key={player.id}>
                        <span>{player.displayName}</span>
                        {selectedGame.status === 'finished' ? <strong>{scorePlayer(player, selectedGame.pages)} pts</strong> : <small>Joined</small>}
                      </li>
                    ))}
                  </ul>
                  {selectedGame.status === 'finished' ? (
                    <>
                      <h3>Leaderboard</h3>
                      <ol className="leaderboard">
                        {adminLeaderboard.map((player) => (
                          <li key={player.id}>
                            <span>{player.displayName}</span>
                            <strong>{scorePlayer(player, selectedGame.pages)} pts</strong>
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : null}
                </section>
              </>
            ) : isAdminUser ? (
              <section className="panel">
                <p>Create a game to start editing.</p>
              </section>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="main-grid player-grid">
          <section className="panel stack-gap">
            <div className="panel-header">
              <div>
                <h2>Join as player</h2>
                <p>Enter the live game code and your display name.</p>
              </div>
              {playerSession ? (
                <button className="ghost-button" type="button" onClick={leaveJoinedGame}>
                  Leave this device
                </button>
              ) : null}
            </div>
            <form className="stack-gap" onSubmit={handleJoinGame}>
              <div className="form-grid">
                <label>
                  <span>Game code</span>
                  <input maxLength={5} value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} />
                </label>
                <label>
                  <span>Display name</span>
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </label>
              </div>
              <button className="primary-button" type="submit" disabled={joinBusy || !firebaseConfigReady}>
                {joinBusy ? 'Joining…' : 'Join game'}
              </button>
              {joinError ? <p className="error-text">{joinError}</p> : null}
              {joinMessage ? <p className="success-text">{joinMessage}</p> : null}
            </form>
          </section>

          <div className="stack-gap">
            {joinedGame ? (
              <section className="panel stack-gap">
                <div className="panel-header compact">
                  <div>
                    <p className="eyebrow">Current game</p>
                    <h2>{joinedGame.title}</h2>
                    <p>Code {joinedGame.code} · {formatStatus(joinedGame.status)}</p>
                  </div>
                  {playerRank >= 0 ? <span className="badge">Rank #{playerRank + 1}</span> : null}
                </div>

                {joinedGame.status === 'published' ? (
                  <div className="guess-card">
                    <h3>Waiting for the presenter</h3>
                    <p>You are checked in as <strong>{joinedPlayer?.displayName ?? playerSession?.displayName}</strong>. The presenter will start the game when everyone is ready.</p>
                  </div>
                ) : null}

                {joinedGame.status === 'live' && activeJoinedPage ? (
                  <div className="guess-card">
                    <p className="eyebrow">Page {joinedGame.activePageIndex + 1} / {joinedGame.pages.length}</p>
                    <h3>{activeJoinedPage.header || 'Who do these photos belong to?'}</h3>
                    {activeJoinedPage.description ? <p>{activeJoinedPage.description}</p> : null}
                    <div className="photo-grid">
                      {activeJoinedPage.photoUrls.map((photoUrl, photoIndex) => (
                        <div key={`${activeJoinedPage.id}-${photoIndex}`} className="photo-frame">
                          <img src={photoUrl} alt={`Photo ${photoIndex + 1} for page ${joinedGame.activePageIndex + 1}`} />
                        </div>
                      ))}
                    </div>
                    <label>
                      <span>Your guess</span>
                      <input value={currentGuess} onChange={(event) => setCurrentGuess(event.target.value)} />
                    </label>
                    <p className="helper-text">Your latest typed guess is saved automatically and can be changed until the presenter finishes the game.</p>
                    {guessError ? <p className="error-text">{guessError}</p> : null}
                    {guessSaveMessage ? <p className="success-text">{guessSaveMessage}</p> : null}
                  </div>
                ) : null}

                {joinedGame.status === 'finished' ? (
                  <div className="stack-gap">
                    <div className="guess-card">
                      <h3>Final leaderboard</h3>
                      <ol className="leaderboard">
                        {playerLeaderboard.map((player) => (
                          <li key={player.id}>
                            <span>{player.displayName}</span>
                            <strong>{scorePlayer(player, joinedGame.pages)} pts</strong>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="guess-card">
                      <h3>Correct answers</h3>
                      <ol className="answer-list">
                        {joinedGame.pages.map((page, index) => (
                          <li key={page.id}>
                            <div>
                              <strong>Page {index + 1}</strong>
                              <p>{page.header || 'No header'}</p>
                            </div>
                            <div>
                              <span>Correct: {page.personName}</span>
                              {joinedPlayer ? <small>Your guess: {joinedPlayer.guesses[page.id] || 'No answer'}</small> : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="panel">
                <h2>No live player session yet</h2>
                <p>Once you join a game, the current page, your saved guess, and the final leaderboard will appear here.</p>
              </section>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function buildValidationErrors(game: GameRecord) {
  return sanitizePages(game.pages).reduce<string[]>((errors, page, pageIndex) => {
    if (!game.title.trim()) {
      errors.push('Game title is required.')
    }

    if (!page.personName.trim()) {
      errors.push(`Page ${pageIndex + 1}: correct person name is required.`)
    }

    page.photoUrls.forEach((photoUrl, photoIndex) => {
      if (!photoUrl) {
        errors.push(`Page ${pageIndex + 1}: photo link ${photoIndex + 1} is required.`)
      }
    })

    return errors
  }, [])
}

function movePage(
  editorGame: GameRecord,
  pageId: string,
  direction: -1 | 1,
  updateEditor: (updater: (currentGame: GameRecord) => GameRecord) => void,
) {
  const currentIndex = editorGame.pages.findIndex((page) => page.id === pageId)
  const nextIndex = currentIndex + direction

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= editorGame.pages.length) {
    return
  }

  updateEditor((currentGame) => {
    const nextPages = [...currentGame.pages]
    const [movedPage] = nextPages.splice(currentIndex, 1)
    nextPages.splice(nextIndex, 0, movedPage!)

    return {
      ...currentGame,
      pages: nextPages,
      activePageIndex:
        currentGame.activePageIndex === currentIndex
          ? nextIndex
          : currentGame.activePageIndex === nextIndex
            ? currentIndex
            : currentGame.activePageIndex,
    }
  })
}

export default App
