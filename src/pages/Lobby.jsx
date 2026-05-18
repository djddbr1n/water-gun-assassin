import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  addDoc,
  writeBatch,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { getUserId, getPlayerSession, formTeams, assignTargets } from '../utils/gameLogic.js'

export default function Lobby() {
  const { gameId } = useParams()
  const navigate = useNavigate()

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [startLoading, setStartLoading] = useState(false)
  const [error, setError] = useState('')

  const userId = getUserId()
  const session = getPlayerSession(gameId)

  // Listen to game doc
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'games', gameId), (snap) => {
      if (!snap.exists()) {
        navigate('/')
        return
      }
      const data = { id: snap.id, ...snap.data() }
      setGame(data)
      setLoading(false)
      if (data.status === 'active') {
        navigate(`/game/${gameId}`)
      }
    })
    return unsub
  }, [gameId, navigate])

  // Listen to players subcollection
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'games', gameId, 'players'), (snap) => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [gameId])

  async function handleStartGame() {
    if (players.length < 4) return
    setStartLoading(true)
    setError('')
    try {
      const batch = writeBatch(db)

      // Form teams
      const playerObjs = players.map(p => ({ id: p.id, name: p.name }))
      const teamGroups = formTeams(playerObjs)

      // Create team docs and collect their IDs
      const teamIds = []
      const teamRefs = []
      for (let i = 0; i < teamGroups.length; i++) {
        const teamRef = doc(collection(db, 'games', gameId, 'teams'))
        const memberIds = teamGroups[i].map(p => p.id)
        batch.set(teamRef, {
          name: `Team ${i + 1}`,
          memberIds,
          targetTeamId: '',
          eliminated: false,
          eliminationCount: 0,
        })
        teamIds.push(teamRef.id)
        teamRefs.push({ ref: teamRef, memberIds })
      }

      // Assign circular targets
      const targets = assignTargets(teamIds)

      // Update teams with targetTeamId
      for (let i = 0; i < teamRefs.length; i++) {
        batch.update(teamRefs[i].ref, { targetTeamId: targets[teamIds[i]] })
      }

      // Update each player with their teamId
      for (let i = 0; i < teamRefs.length; i++) {
        for (const memberId of teamRefs[i].memberIds) {
          batch.update(doc(db, 'games', gameId, 'players', memberId), {
            teamId: teamIds[i],
          })
        }
      }

      // Set game to active
      batch.update(doc(db, 'games', gameId), { status: 'active' })

      await batch.commit()
    } catch (err) {
      setError('Failed to start game. Please try again.')
      console.error(err)
    } finally {
      setStartLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-cyan-400 text-xl animate-pulse">Loading lobby...</div>
      </div>
    )
  }

  const isAdmin = game?.adminUserId === userId
  const canStart = players.length >= 4

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-white mb-2">💧 Water Gun Assassin</h1>
          <p className="text-slate-400">Share the code below with your friends!</p>
        </div>

        {/* Game Code */}
        <div className="bg-slate-800 border border-cyan-700 rounded-2xl p-6 text-center mb-8 shadow-lg">
          <p className="text-slate-400 text-sm uppercase tracking-widest mb-2">Game Code</p>
          <p className="font-mono text-5xl font-extrabold text-cyan-400 tracking-[0.3em]">{game?.code}</p>
          <button
            onClick={() => navigator.clipboard.writeText(game?.code)}
            className="mt-3 text-slate-400 hover:text-cyan-400 text-sm transition-colors"
          >
            📋 Copy to clipboard
          </button>
        </div>

        {/* Players List */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 mb-8 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">Players</h2>
            <span className="text-slate-400 text-sm">{players.length} joined</span>
          </div>
          {players.length === 0 ? (
            <p className="text-slate-500 text-sm italic">Waiting for players to join...</p>
          ) : (
            <ul className="space-y-2">
              {players.map(p => (
                <li key={p.id} className="flex items-center gap-3 bg-slate-700 rounded-lg px-4 py-3">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0"></span>
                  <span className="text-white font-medium">{p.name}</span>
                  {p.userId === game?.adminUserId && (
                    <span className="ml-auto text-xs bg-cyan-900 text-cyan-300 px-2 py-0.5 rounded-full font-semibold">Admin</span>
                  )}
                  {p.userId === userId && p.userId !== game?.adminUserId && (
                    <span className="ml-auto text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full">You</span>
                  )}
                  {p.userId === userId && p.userId === game?.adminUserId && (
                    <span className="text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full">You</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Rejoin Link */}
        {session && (
          <div className="bg-slate-800 border border-yellow-700 rounded-2xl p-5 mb-8 shadow-lg">
            <p className="text-yellow-400 font-semibold text-sm mb-1">🔖 Bookmark your rejoin link</p>
            <p className="text-slate-400 text-xs mb-3">Save this link so you can get back into the game from any device, even if you close the app.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${window.location.origin}/rejoin/${gameId}/${session.playerId}`}
                className="flex-1 bg-slate-700 text-slate-300 text-xs rounded-lg px-3 py-2 font-mono truncate focus:outline-none"
              />
              <button
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/rejoin/${gameId}/${session.playerId}`)}
                className="bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* Start / Waiting */}
        {isAdmin ? (
          <div className="text-center">
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            {!canStart && (
              <p className="text-slate-400 text-sm mb-3">Need at least 4 players to start ({4 - players.length} more needed)</p>
            )}
            <button
              onClick={handleStartGame}
              disabled={!canStart || startLoading}
              className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg transition-colors duration-150 shadow-lg"
            >
              {startLoading ? 'Starting...' : '🚀 Start Game'}
            </button>
          </div>
        ) : (
          <div className="text-center bg-slate-800 border border-slate-700 rounded-2xl p-6">
            <div className="text-3xl mb-2 animate-bounce">⏳</div>
            <p className="text-slate-300 font-medium">Waiting for the admin to start the game...</p>
            <p className="text-slate-500 text-sm mt-1">You're in! Sit tight.</p>
          </div>
        )}
      </div>
    </div>
  )
}
