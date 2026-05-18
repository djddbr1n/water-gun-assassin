import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { generateGameCode, getUserId, setPlayerSession } from '../utils/gameLogic.js'

function getSavedSessions() {
  const sessions = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('wga_game_')) {
      try {
        const data = JSON.parse(localStorage.getItem(key))
        const gameId = key.replace('wga_game_', '')
        if (data?.playerId && data?.name) {
          sessions.push({ gameId, playerId: data.playerId, name: data.name })
        }
      } catch {}
    }
  }
  return sessions
}

export default function Home() {
  const navigate = useNavigate()
  const [savedSessions, setSavedSessions] = useState([])

  useEffect(() => {
    setSavedSessions(getSavedSessions())
  }, [])
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  const [joinCode, setJoinCode] = useState('')
  const [joinStep, setJoinStep] = useState('code') // 'code' | 'name'
  const [joinName, setJoinName] = useState('')
  const [joinGameData, setJoinGameData] = useState(null)
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')

  async function handleCreateGame(e) {
    e.preventDefault()
    if (!createName.trim()) return
    setCreateLoading(true)
    setCreateError('')
    try {
      const userId = getUserId()
      const code = generateGameCode()
      const gameRef = await addDoc(collection(db, 'games'), {
        code,
        status: 'lobby',
        adminUserId: userId,
        createdAt: serverTimestamp(),
        winnerTeamId: null,
      })
      const playerRef = await addDoc(collection(db, 'games', gameRef.id, 'players'), {
        name: createName.trim(),
        userId,
        teamId: '',
        eliminated: false,
        eliminationCount: 0,
      })
      setPlayerSession(gameRef.id, { playerId: playerRef.id, name: createName.trim() })
      navigate(`/lobby/${gameRef.id}`)
    } catch (err) {
      setCreateError('Failed to create game. Check your Firebase config.')
      console.error(err)
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleFindGame(e) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 6) {
      setJoinError('Enter a valid 6-character game code.')
      return
    }
    setJoinLoading(true)
    setJoinError('')
    try {
      const q = query(collection(db, 'games'), where('code', '==', code), where('status', '==', 'lobby'))
      const snap = await getDocs(q)
      if (snap.empty) {
        setJoinError('No open game found with that code. Make sure the game is still in the lobby.')
        setJoinLoading(false)
        return
      }
      const gameDoc = snap.docs[0]
      setJoinGameData({ id: gameDoc.id, ...gameDoc.data() })
      setJoinStep('name')
    } catch (err) {
      setJoinError('Error searching for game.')
      console.error(err)
    } finally {
      setJoinLoading(false)
    }
  }

  async function handleJoinGame(e) {
    e.preventDefault()
    if (!joinName.trim()) return
    setJoinLoading(true)
    setJoinError('')
    try {
      const userId = getUserId()
      // Check if this userId already has a player doc in the game
      const existingQ = query(
        collection(db, 'games', joinGameData.id, 'players'),
        where('userId', '==', userId)
      )
      const existingSnap = await getDocs(existingQ)
      if (!existingSnap.empty) {
        const existingPlayer = existingSnap.docs[0]
        setPlayerSession(joinGameData.id, { playerId: existingPlayer.id, name: existingPlayer.data().name })
        navigate(`/lobby/${joinGameData.id}`)
        return
      }
      const playerRef = await addDoc(collection(db, 'games', joinGameData.id, 'players'), {
        name: joinName.trim(),
        userId,
        teamId: '',
        eliminated: false,
        eliminationCount: 0,
      })
      setPlayerSession(joinGameData.id, { playerId: playerRef.id, name: joinName.trim() })
      navigate(`/lobby/${joinGameData.id}`)
    } catch (err) {
      setJoinError('Failed to join game.')
      console.error(err)
    } finally {
      setJoinLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-extrabold text-white tracking-tight mb-3">
          💧 Water Gun Assassin
        </h1>
        <p className="text-cyan-400 text-lg">Soak your enemies. Outlast everyone. Win glory.</p>
      </div>

      {/* Cards */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Create Game */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-2">Create a Game</h2>
          <p className="text-slate-400 text-sm mb-6">Start a new lobby and invite your friends with a 6-character code.</p>
          <form onSubmit={handleCreateGame} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Your Name</label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="Enter your name..."
                maxLength={24}
                className="w-full bg-slate-700 border border-slate-600 text-white rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                required
              />
            </div>
            {createError && <p className="text-red-400 text-sm">{createError}</p>}
            <button
              type="submit"
              disabled={createLoading || !createName.trim()}
              className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors duration-150"
            >
              {createLoading ? 'Creating...' : '🎮 Create Game'}
            </button>
          </form>
        </div>

        {/* Join Game */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-2">Join a Game</h2>
          <p className="text-slate-400 text-sm mb-6">Enter the 6-character code your friend shared with you.</p>

          {joinStep === 'code' ? (
            <form onSubmit={handleFindGame} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Game Code</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                  placeholder="ABCDEF"
                  maxLength={6}
                  className="w-full bg-slate-700 border border-slate-600 text-white rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent tracking-widest text-center text-xl font-mono uppercase"
                  required
                />
              </div>
              {joinError && <p className="text-red-400 text-sm">{joinError}</p>}
              <button
                type="submit"
                disabled={joinLoading || joinCode.trim().length !== 6}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors duration-150"
              >
                {joinLoading ? 'Searching...' : '🔍 Find Game'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoinGame} className="space-y-4">
              <div className="bg-slate-700 rounded-lg px-4 py-2 flex items-center gap-3 mb-2">
                <span className="text-slate-400 text-sm">Game found:</span>
                <span className="font-mono text-cyan-400 font-bold tracking-widest">{joinGameData?.code}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Your Name</label>
                <input
                  type="text"
                  value={joinName}
                  onChange={e => setJoinName(e.target.value)}
                  placeholder="Enter your name..."
                  maxLength={24}
                  className="w-full bg-slate-700 border border-slate-600 text-white rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  required
                />
              </div>
              {joinError && <p className="text-red-400 text-sm">{joinError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setJoinStep('code'); setJoinError(''); setJoinGameData(null) }}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-3 rounded-lg transition-colors duration-150"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={joinLoading || !joinName.trim()}
                  className="flex-2 flex-grow bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors duration-150"
                >
                  {joinLoading ? 'Joining...' : '💧 Join Game'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Rejoin saved sessions */}
      {savedSessions.length > 0 && (
        <div className="w-full max-w-4xl mt-8">
          <div className="bg-slate-800 border border-yellow-700 rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-bold text-yellow-400 mb-1">🔖 Rejoin a game</h2>
            <p className="text-slate-400 text-sm mb-4">You have saved sessions on this device.</p>
            <ul className="space-y-2">
              {savedSessions.map(s => (
                <li key={s.gameId} className="flex items-center justify-between bg-slate-700 rounded-lg px-4 py-3">
                  <div>
                    <span className="text-white font-medium">{s.name}</span>
                    <span className="text-slate-500 text-xs ml-2 font-mono">{s.gameId.slice(0, 8)}...</span>
                  </div>
                  <button
                    onClick={() => navigate(`/rejoin/${s.gameId}/${s.playerId}`)}
                    className="bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-bold px-4 py-1.5 rounded-lg transition-colors"
                  >
                    Rejoin
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <p className="mt-10 text-slate-600 text-sm">Minimum 4 players required to start a game.</p>
    </div>
  )
}
