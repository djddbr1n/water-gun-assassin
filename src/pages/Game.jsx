import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc,
  collection,
  onSnapshot,
  addDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { getUserId, getPlayerSession } from '../utils/gameLogic.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getMyPlayer(players, session) {
  if (!session) return null
  return players.find(p => p.id === session.playerId) || null
}

function getMyTeam(teams, myPlayer) {
  if (!myPlayer) return null
  return teams.find(t => t.id === myPlayer.teamId) || null
}

function getTargetTeam(teams, myTeam) {
  if (!myTeam) return null
  return teams.find(t => t.id === myTeam.targetTeamId) || null
}

function getTeamMembers(players, team) {
  if (!team) return []
  return players.filter(p => team.memberIds.includes(p.id))
}

// ─── Elimination cascade helper ─────────────────────────────────────────────

async function handleEliminationCascade(batch, gameId, eliminatedPlayerId, allPlayers, allTeams) {
  const eliminatedPlayer = allPlayers.find(p => p.id === eliminatedPlayerId)
  if (!eliminatedPlayer) return { gameEnded: false }

  const eliminatedTeam = allTeams.find(t => t.id === eliminatedPlayer.teamId)
  if (!eliminatedTeam) return { gameEnded: false }

  // Get all members of the eliminated player's team (including this player being marked eliminated now)
  const teamMembers = allPlayers.filter(p => eliminatedTeam.memberIds.includes(p.id))
  const allEliminated = teamMembers.every(p => p.id === eliminatedPlayerId || p.eliminated)

  if (!allEliminated) return { gameEnded: false }

  // Mark the team as eliminated
  batch.update(doc(db, 'games', gameId, 'teams', eliminatedTeam.id), { eliminated: true })

  // Find which team was targeting the eliminated team and update their target
  const attackingTeam = allTeams.find(t => t.targetTeamId === eliminatedTeam.id && !t.eliminated)
  if (attackingTeam) {
    batch.update(doc(db, 'games', gameId, 'teams', attackingTeam.id), {
      targetTeamId: eliminatedTeam.targetTeamId,
    })
  }

  // Check if only 1 team remains
  const remainingTeams = allTeams.filter(t => t.id !== eliminatedTeam.id && !t.eliminated)
  if (remainingTeams.length === 1) {
    batch.update(doc(db, 'games', gameId), {
      status: 'ended',
      winnerTeamId: remainingTeams[0].id,
    })
    return { gameEnded: true, winnerTeamId: remainingTeams[0].id }
  }

  return { gameEnded: false }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// ─── My Team Tab ─────────────────────────────────────────────────────────────

function MyTeamTab({ myPlayer, myTeam, targetTeam, players, teams, eliminations, gameId, setError }) {
  const [markLoading, setMarkLoading] = useState({})

  const myTeamMembers = getTeamMembers(players, myTeam)
  const targetTeamMembers = getTeamMembers(players, targetTeam)

  async function handleMarkEliminated(targetPlayer) {
    if (!myPlayer || myPlayer.eliminated) return
    setMarkLoading(prev => ({ ...prev, [targetPlayer.id]: true }))
    setError('')
    try {
      // Check there's no pending elimination for this target already
      const pending = eliminations.find(
        e => e.targetPlayerId === targetPlayer.id && e.status === 'pending'
      )
      if (pending) {
        setError('There is already a pending elimination for this player.')
        return
      }
      await addDoc(collection(db, 'games', gameId, 'eliminations'), {
        eliminatorPlayerId: myPlayer.id,
        targetPlayerId: targetPlayer.id,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      setError('Failed to report elimination.')
      console.error(err)
    } finally {
      setMarkLoading(prev => ({ ...prev, [targetPlayer.id]: false }))
    }
  }

  return (
    <div className="space-y-6">
      {/* My Team */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-1">
          {myTeam ? myTeam.name : 'Your Team'}
          {myTeam?.eliminated && <span className="ml-2 text-sm text-red-400 font-normal">— Eliminated</span>}
        </h3>
        <p className="text-slate-400 text-xs mb-4">Your teammates</p>
        <div className="space-y-2">
          {myTeamMembers.map(p => (
            <div key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${p.eliminated ? 'bg-slate-800 opacity-50' : 'bg-slate-700'} ${p.id === myPlayer?.id ? 'ring-1 ring-cyan-500' : ''}`}>
              <span className={`text-sm font-medium ${p.eliminated ? 'line-through text-slate-500' : 'text-white'}`}>
                {p.name}
                {p.id === myPlayer?.id && <span className="ml-1 text-cyan-400 text-xs">(you)</span>}
              </span>
              {p.eliminated && <span className="text-xs text-red-400 font-semibold ml-auto">💀 OUT</span>}
              {!p.eliminated && <span className="ml-auto text-xs text-cyan-400">💧 {p.eliminationCount}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Target Team */}
      <div className="bg-slate-800 border border-red-900 rounded-xl p-5">
        <h3 className="text-lg font-bold text-red-400 mb-1">
          🎯 Your Target: {targetTeam ? targetTeam.name : '???'}
          {targetTeam?.eliminated && <span className="ml-2 text-sm text-red-600 font-normal">— Eliminated</span>}
        </h3>
        <p className="text-slate-400 text-xs mb-4">Eliminate all members of this team!</p>

        {myPlayer?.eliminated ? (
          <p className="text-slate-500 italic text-sm">You have been eliminated. You can no longer make elimination reports.</p>
        ) : myTeam?.eliminated ? (
          <p className="text-slate-500 italic text-sm">Your team has been eliminated.</p>
        ) : targetTeam?.eliminated ? (
          <p className="text-slate-400 italic text-sm">This team has already been eliminated. Waiting for target update...</p>
        ) : (
          <div className="space-y-3">
            {targetTeamMembers.map(p => {
              const pendingForTarget = eliminations.find(
                e => e.targetPlayerId === p.id && e.status === 'pending'
              )
              return (
                <div key={p.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${p.eliminated ? 'bg-slate-800 opacity-50' : 'bg-slate-700'}`}>
                  <span className={`text-sm font-medium flex-1 ${p.eliminated ? 'line-through text-slate-500' : 'text-white'}`}>
                    {p.name}
                  </span>
                  {p.eliminated ? (
                    <span className="text-xs text-red-400 font-semibold">💀 OUT</span>
                  ) : pendingForTarget ? (
                    <span className="text-xs text-yellow-400 font-semibold">⏳ Pending...</span>
                  ) : (
                    <button
                      onClick={() => handleMarkEliminated(p)}
                      disabled={markLoading[p.id]}
                      className="text-xs bg-red-700 hover:bg-red-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {markLoading[p.id] ? 'Reporting...' : '💦 I got them!'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Eliminations Tab ────────────────────────────────────────────────────────

function EliminationsTab({ myPlayer, players, teams, eliminations, gameId, setError }) {
  const [actionLoading, setActionLoading] = useState({})

  const incoming = eliminations.filter(
    e => e.targetPlayerId === myPlayer?.id && e.status === 'pending'
  )
  const outgoing = eliminations.filter(
    e => e.eliminatorPlayerId === myPlayer?.id
  )

  function getPlayerName(playerId) {
    return players.find(p => p.id === playerId)?.name || 'Unknown'
  }

  async function handleConfirm(elimination) {
    setActionLoading(prev => ({ ...prev, [elimination.id]: 'confirming' }))
    setError('')
    try {
      const batch = writeBatch(db)

      // Mark elimination confirmed
      batch.update(doc(db, 'games', gameId, 'eliminations', elimination.id), { status: 'confirmed' })

      // Mark target player as eliminated
      batch.update(doc(db, 'games', gameId, 'players', elimination.targetPlayerId), { eliminated: true })

      // Increment eliminator's count
      const eliminator = players.find(p => p.id === elimination.eliminatorPlayerId)
      if (eliminator) {
        batch.update(doc(db, 'games', gameId, 'players', elimination.eliminatorPlayerId), {
          eliminationCount: (eliminator.eliminationCount || 0) + 1,
        })
        // Also update the eliminator's team count
        const eliminatorTeam = teams.find(t => t.id === eliminator.teamId)
        if (eliminatorTeam) {
          batch.update(doc(db, 'games', gameId, 'teams', eliminatorTeam.id), {
            eliminationCount: (eliminatorTeam.eliminationCount || 0) + 1,
          })
        }
      }

      // Handle cascade: check if team fully eliminated, update targeter, check game over
      await handleEliminationCascade(batch, gameId, elimination.targetPlayerId, players, teams)

      await batch.commit()
    } catch (err) {
      setError('Failed to confirm elimination.')
      console.error(err)
    } finally {
      setActionLoading(prev => ({ ...prev, [elimination.id]: null }))
    }
  }

  async function handleDispute(elimination) {
    setActionLoading(prev => ({ ...prev, [elimination.id]: 'disputing' }))
    setError('')
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'games', gameId, 'eliminations', elimination.id), { status: 'disputed' })
      await batch.commit()
    } catch (err) {
      setError('Failed to dispute elimination.')
      console.error(err)
    } finally {
      setActionLoading(prev => ({ ...prev, [elimination.id]: null }))
    }
  }

  const statusBadge = (status) => {
    if (status === 'pending') return <span className="text-xs bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded-full">Pending</span>
    if (status === 'confirmed') return <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">Confirmed</span>
    if (status === 'disputed') return <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">Disputed</span>
    return null
  }

  return (
    <div className="space-y-6">
      {/* Incoming */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-1">Incoming Claims</h3>
        <p className="text-slate-400 text-xs mb-4">Someone says they eliminated you — confirm or dispute.</p>
        {incoming.length === 0 ? (
          <p className="text-slate-500 italic text-sm">No pending elimination claims against you.</p>
        ) : (
          <div className="space-y-3">
            {incoming.map(e => (
              <div key={e.id} className="bg-slate-700 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="text-white text-sm">
                    <span className="font-semibold text-red-400">{getPlayerName(e.eliminatorPlayerId)}</span>
                    {' '}says they eliminated you.
                  </p>
                </div>
                {myPlayer?.eliminated ? (
                  <span className="text-xs text-slate-400">Already eliminated</span>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirm(e)}
                      disabled={actionLoading[e.id]}
                      className="text-xs bg-green-700 hover:bg-green-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {actionLoading[e.id] === 'confirming' ? 'Confirming...' : '✓ Confirm'}
                    </button>
                    <button
                      onClick={() => handleDispute(e)}
                      disabled={actionLoading[e.id]}
                      className="text-xs bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {actionLoading[e.id] === 'disputing' ? 'Disputing...' : '✗ Dispute'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outgoing */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-1">My Elimination Claims</h3>
        <p className="text-slate-400 text-xs mb-4">Eliminations you've reported.</p>
        {outgoing.length === 0 ? (
          <p className="text-slate-500 italic text-sm">You haven't reported any eliminations yet.</p>
        ) : (
          <div className="space-y-2">
            {outgoing.map(e => (
              <div key={e.id} className="bg-slate-700 rounded-lg px-4 py-3 flex items-center gap-3">
                <p className="text-white text-sm flex-1">
                  Eliminated <span className="font-semibold text-cyan-400">{getPlayerName(e.targetPlayerId)}</span>
                </p>
                {statusBadge(e.status)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Leaderboard Tab ─────────────────────────────────────────────────────────

function LeaderboardTab({ players, teams }) {
  const sortedTeams = [...teams].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1
    return (b.eliminationCount || 0) - (a.eliminationCount || 0)
  })
  const sortedPlayers = [...players].sort((a, b) => {
    return (b.eliminationCount || 0) - (a.eliminationCount || 0)
  })

  function getTeamName(teamId) {
    return teams.find(t => t.id === teamId)?.name || '—'
  }

  return (
    <div className="space-y-6">
      {/* Teams */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-4">Teams</h3>
        <div className="space-y-3">
          {sortedTeams.map((team, idx) => (
            <div key={team.id} className={`flex items-center gap-3 rounded-lg px-4 py-3 ${team.eliminated ? 'bg-slate-800 opacity-60' : 'bg-slate-700'}`}>
              <span className="text-slate-400 font-bold w-6 text-sm">#{idx + 1}</span>
              <div className="flex-1">
                <p className={`font-semibold text-sm ${team.eliminated ? 'line-through text-slate-500' : 'text-white'}`}>{team.name}</p>
                <p className="text-xs text-slate-400">
                  {team.memberIds?.length || 0} members
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 text-sm font-bold">💧 {team.eliminationCount || 0}</span>
                {team.eliminated ? (
                  <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">Eliminated</span>
                ) : (
                  <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">Alive</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Players */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-4">Players</h3>
        <div className="space-y-2">
          {sortedPlayers.map((p, idx) => (
            <div key={p.id} className={`flex items-center gap-3 rounded-lg px-4 py-2.5 ${p.eliminated ? 'bg-slate-800 opacity-60' : 'bg-slate-700'}`}>
              <span className="text-slate-400 font-bold w-6 text-sm">#{idx + 1}</span>
              <div className="flex-1">
                <p className={`text-sm font-medium ${p.eliminated ? 'line-through text-slate-500' : 'text-white'}`}>{p.name}</p>
                <p className="text-xs text-slate-400">{getTeamName(p.teamId)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 text-sm font-bold">💧 {p.eliminationCount || 0}</span>
                {p.eliminated && <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">💀 Out</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Game Page ───────────────────────────────────────────────────────────

export default function Game() {
  const { gameId } = useParams()
  const navigate = useNavigate()

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [eliminations, setEliminations] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('myteam')
  const [error, setError] = useState('')

  const userId = getUserId()
  const session = getPlayerSession(gameId)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'games', gameId), snap => {
      if (!snap.exists()) { navigate('/'); return }
      setGame({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
    return unsub
  }, [gameId, navigate])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'games', gameId, 'players'), snap => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [gameId])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'games', gameId, 'teams'), snap => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [gameId])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'games', gameId, 'eliminations'), snap => {
      setEliminations(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [gameId])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-cyan-400 text-xl animate-pulse">Loading game...</div>
      </div>
    )
  }

  const myPlayer = getMyPlayer(players, session)
  const myTeam = getMyTeam(teams, myPlayer)
  const targetTeam = getTargetTeam(teams, myTeam)

  // Pending incoming eliminations (this player is a target)
  const pendingIncoming = eliminations.filter(
    e => e.targetPlayerId === myPlayer?.id && e.status === 'pending'
  )

  const tabs = [
    { id: 'myteam', label: 'My Team' },
    { id: 'eliminations', label: 'Eliminations', badge: pendingIncoming.length },
    { id: 'leaderboard', label: 'Leaderboard' },
  ]

  const winnerTeam = game?.winnerTeamId ? teams.find(t => t.id === game.winnerTeamId) : null

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-8">
      {/* Game Over Overlay */}
      {game?.status === 'ended' && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-cyan-500 rounded-3xl p-10 text-center max-w-md w-full shadow-2xl">
            <div className="text-7xl mb-4">🎉</div>
            <h2 className="text-4xl font-extrabold text-white mb-2">Game Over!</h2>
            <p className="text-slate-400 mb-6">The water has settled...</p>
            <div className="bg-cyan-900 border border-cyan-600 rounded-2xl px-6 py-5 mb-6">
              <p className="text-cyan-300 text-sm uppercase tracking-widest mb-1">Winner</p>
              <p className="text-3xl font-extrabold text-white">{winnerTeam?.name || 'Unknown Team'}</p>
              <p className="text-cyan-400 text-lg mt-1">💧 {winnerTeam?.eliminationCount || 0} eliminations</p>
            </div>
            <div className="text-4xl mb-4">🔫💦🎊🏆💧</div>
            <button
              onClick={() => setActiveTab('leaderboard')}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-white font-bold py-3 rounded-xl transition-colors"
            >
              View Final Leaderboard
            </button>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-extrabold text-white">💧 Water Gun Assassin</h1>
            <p className="text-slate-400 text-sm">
              {myPlayer ? (
                <>Playing as <span className="text-cyan-400 font-semibold">{myPlayer.name}</span>
                  {myTeam && <> · <span className="text-slate-300">{myTeam.name}</span></>}
                </>
              ) : 'Spectating'}
            </p>
          </div>
          {game?.status === 'active' && (
            <span className="text-xs bg-green-900 text-green-300 px-3 py-1 rounded-full font-semibold">🟢 LIVE</span>
          )}
          {game?.status === 'ended' && (
            <span className="text-xs bg-slate-700 text-slate-300 px-3 py-1 rounded-full font-semibold">🏁 ENDED</span>
          )}
        </div>

        {/* Rejoin link */}
        {session && (
          <details className="mb-4 bg-slate-800 border border-slate-700 rounded-xl">
            <summary className="px-4 py-3 text-slate-400 text-xs cursor-pointer hover:text-slate-300 select-none">
              🔖 Get your rejoin link (bookmark to re-enter from any device)
            </summary>
            <div className="px-4 pb-4 flex gap-2 mt-2">
              <input
                readOnly
                value={`${window.location.origin}/rejoin/${gameId}/${session.playerId}`}
                className="flex-1 bg-slate-700 text-slate-300 text-xs rounded-lg px-3 py-2 font-mono truncate focus:outline-none"
              />
              <button
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/rejoin/${gameId}/${session.playerId}`)}
                className="bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
              >
                Copy
              </button>
            </div>
          </details>
        )}

        {/* My status banner */}
        {myPlayer?.eliminated && (
          <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 mb-6 text-center">
            <p className="text-red-400 font-semibold">💀 You have been eliminated. You can still watch the game!</p>
          </div>
        )}

        {/* Pending claims banner */}
        {pendingIncoming.length > 0 && !myPlayer?.eliminated && (
          <button
            onClick={() => setActiveTab('eliminations')}
            className="w-full bg-yellow-900 border border-yellow-700 rounded-xl px-4 py-3 mb-6 text-center hover:bg-yellow-800 transition-colors"
          >
            <p className="text-yellow-300 font-semibold">⚠️ {pendingIncoming.length} pending elimination claim{pendingIncoming.length > 1 ? 's' : ''} — tap to respond!</p>
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-4">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-700 mb-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${
                activeTab === tab.id
                  ? 'text-cyan-400 border-b-2 border-cyan-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {tab.label}
              {tab.badge > 0 && (
                <span className="ml-1.5 bg-yellow-500 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'myteam' && (
          <MyTeamTab
            myPlayer={myPlayer}
            myTeam={myTeam}
            targetTeam={targetTeam}
            players={players}
            teams={teams}
            eliminations={eliminations}
            gameId={gameId}
            setError={setError}
          />
        )}
        {activeTab === 'eliminations' && (
          <EliminationsTab
            myPlayer={myPlayer}
            players={players}
            teams={teams}
            eliminations={eliminations}
            gameId={gameId}
            setError={setError}
          />
        )}
        {activeTab === 'leaderboard' && (
          <LeaderboardTab
            players={players}
            teams={teams}
          />
        )}
      </div>
    </div>
  )
}
