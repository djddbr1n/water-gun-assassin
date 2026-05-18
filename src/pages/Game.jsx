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
      const batch = writeBatch(db)

      // Create elimination record as immediately confirmed
      const elimRef = doc(collection(db, 'games', gameId, 'eliminations'))
      batch.set(elimRef, {
        eliminatorPlayerId: myPlayer.id,
        targetPlayerId: targetPlayer.id,
        status: 'confirmed',
        disputed: false,
        disputeMessage: '',
        createdAt: serverTimestamp(),
      })

      // Mark target as eliminated
      batch.update(doc(db, 'games', gameId, 'players', targetPlayer.id), { eliminated: true })

      // Increment eliminator count
      batch.update(doc(db, 'games', gameId, 'players', myPlayer.id), {
        eliminationCount: (myPlayer.eliminationCount || 0) + 1,
      })

      // Increment eliminator's team count
      const myTeamDoc = teams.find(t => t.id === myPlayer.teamId)
      if (myTeamDoc) {
        batch.update(doc(db, 'games', gameId, 'teams', myTeamDoc.id), {
          eliminationCount: (myTeamDoc.eliminationCount || 0) + 1,
        })
      }

      // Cascade: check if target team is fully eliminated
      await handleEliminationCascade(batch, gameId, targetPlayer.id, players, teams)

      await batch.commit()
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
              return (
                <div key={p.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${p.eliminated ? 'bg-slate-800 opacity-50' : 'bg-slate-700'}`}>
                  <span className={`text-sm font-medium flex-1 ${p.eliminated ? 'line-through text-slate-500' : 'text-white'}`}>
                    {p.name}
                  </span>
                  {p.eliminated ? (
                    <span className="text-xs text-red-400 font-semibold">💀 OUT</span>
                  ) : (
                    <button
                      onClick={() => handleMarkEliminated(p)}
                      disabled={markLoading[p.id]}
                      className="text-xs bg-red-700 hover:bg-red-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {markLoading[p.id] ? 'Eliminating...' : '💦 Eliminated!'}
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

function EliminationsTab({ myPlayer, players, teams, eliminations, gameId, setError, isAdmin }) {
  const [disputeMsg, setDisputeMsg] = useState({})
  const [disputeLoading, setDisputeLoading] = useState({})

  const myEliminations = eliminations.filter(e => e.eliminatorPlayerId === myPlayer?.id)
  const myDeaths = eliminations.filter(e => e.targetPlayerId === myPlayer?.id && e.status === 'confirmed')
  const allDisputes = eliminations.filter(e => e.disputed)

  function getPlayerName(playerId) {
    return players.find(p => p.id === playerId)?.name || 'Unknown'
  }

  async function handleDispute(elimination) {
    const msg = (disputeMsg[elimination.id] || '').trim()
    if (!msg) return
    setDisputeLoading(prev => ({ ...prev, [elimination.id]: true }))
    setError('')
    try {
      const { updateDoc } = await import('firebase/firestore')
      await updateDoc(doc(db, 'games', gameId, 'eliminations', elimination.id), {
        disputed: true,
        disputeMessage: msg,
      })
      setDisputeMsg(prev => ({ ...prev, [elimination.id]: '' }))
    } catch (err) {
      setError('Failed to file dispute.')
      console.error(err)
    } finally {
      setDisputeLoading(prev => ({ ...prev, [elimination.id]: false }))
    }
  }

  async function handleDismissDispute(elimination) {
    try {
      const { updateDoc } = await import('firebase/firestore')
      await updateDoc(doc(db, 'games', gameId, 'eliminations', elimination.id), {
        disputed: false,
        disputeMessage: '',
      })
    } catch (err) {
      setError('Failed to dismiss dispute.')
    }
  }

  async function handleRestorePlayer(elimination) {
    try {
      const batch = writeBatch(db)
      const targetPlayer = players.find(p => p.id === elimination.targetPlayerId)
      const eliminator = players.find(p => p.id === elimination.eliminatorPlayerId)

      // Un-eliminate the player
      batch.update(doc(db, 'games', gameId, 'players', elimination.targetPlayerId), { eliminated: false })

      // Decrement eliminator's count
      if (eliminator) {
        batch.update(doc(db, 'games', gameId, 'players', eliminator.id), {
          eliminationCount: Math.max(0, (eliminator.eliminationCount || 0) - 1),
        })
        const eliminatorTeam = teams.find(t => t.id === eliminator.teamId)
        if (eliminatorTeam) {
          batch.update(doc(db, 'games', gameId, 'teams', eliminatorTeam.id), {
            eliminationCount: Math.max(0, (eliminatorTeam.eliminationCount || 0) - 1),
          })
        }
      }

      // If their team was eliminated, restore it and fix the target chain
      const targetTeam = teams.find(t => t.id === targetPlayer?.teamId)
      if (targetTeam?.eliminated) {
        batch.update(doc(db, 'games', gameId, 'teams', targetTeam.id), { eliminated: false })
        // Find the team that took over this team's target and point them back
        const teamThatTookTarget = teams.find(t =>
          t.id !== targetTeam.id && t.targetTeamId === targetTeam.targetTeamId && !t.eliminated
        )
        if (teamThatTookTarget) {
          batch.update(doc(db, 'games', gameId, 'teams', teamThatTookTarget.id), {
            targetTeamId: targetTeam.id,
          })
        }
        // If game ended because of this, reopen it
        if (game?.status === 'ended') {
          batch.update(doc(db, 'games', gameId), { status: 'active', winnerTeamId: null })
        }
      }

      // Clear the dispute
      batch.update(doc(db, 'games', gameId, 'eliminations', elimination.id), {
        disputed: false,
        disputeMessage: '',
        status: 'overturned',
      })

      await batch.commit()
    } catch (err) {
      setError('Failed to restore player.')
      console.error(err)
    }
  }

  return (
    <div className="space-y-6">
      {/* My Eliminations */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-1">My Eliminations</h3>
        <p className="text-slate-400 text-xs mb-4">Players you've eliminated this game.</p>
        {myEliminations.length === 0 ? (
          <p className="text-slate-500 italic text-sm">No eliminations yet — get out there!</p>
        ) : (
          <div className="space-y-2">
            {myEliminations.map(e => (
              <div key={e.id} className="bg-slate-700 rounded-lg px-4 py-3 flex items-center gap-3">
                <p className="text-white text-sm flex-1">
                  💧 <span className="font-semibold text-cyan-400">{getPlayerName(e.targetPlayerId)}</span>
                </p>
                {e.disputed && <span className="text-xs bg-orange-900 text-orange-300 px-2 py-0.5 rounded-full">Disputed</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dispute my own elimination */}
      {myDeaths.map(e => (
        <div key={e.id} className="bg-slate-800 border border-orange-800 rounded-xl p-5">
          <h3 className="text-lg font-bold text-orange-400 mb-1">⚠️ You were eliminated</h3>
          <p className="text-slate-400 text-xs mb-3">
            <span className="text-red-400 font-semibold">{getPlayerName(e.eliminatorPlayerId)}</span> marked you as eliminated.
            {e.disputed ? ' Your dispute has been filed.' : ' Think this was wrong? File a dispute below.'}
          </p>
          {!e.disputed && (
            <div className="space-y-2">
              <textarea
                value={disputeMsg[e.id] || ''}
                onChange={ev => setDisputeMsg(prev => ({ ...prev, [e.id]: ev.target.value }))}
                placeholder="Explain why this elimination is incorrect..."
                rows={3}
                className="w-full bg-slate-700 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
              />
              <button
                onClick={() => handleDispute(e)}
                disabled={disputeLoading[e.id] || !(disputeMsg[e.id] || '').trim()}
                className="w-full bg-orange-700 hover:bg-orange-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-lg text-sm transition-colors"
              >
                {disputeLoading[e.id] ? 'Filing...' : '🚩 File Dispute'}
              </button>
            </div>
          )}
          {e.disputed && (
            <div className="bg-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 italic">"{e.disputeMessage}"</div>
          )}
        </div>
      ))}

      {/* Admin: Disputes panel */}
      {isAdmin && (
        <div className="bg-slate-800 border border-purple-800 rounded-xl p-5">
          <h3 className="text-lg font-bold text-purple-400 mb-1">🛡️ Admin — Open Disputes</h3>
          <p className="text-slate-400 text-xs mb-4">Review disputed eliminations and resolve them.</p>
          {allDisputes.length === 0 ? (
            <p className="text-slate-500 italic text-sm">No open disputes.</p>
          ) : (
            <div className="space-y-3">
              {allDisputes.map(e => (
                <div key={e.id} className="bg-slate-700 rounded-lg px-4 py-3 space-y-2">
                  <p className="text-white text-sm">
                    <span className="text-red-400 font-semibold">{getPlayerName(e.eliminatorPlayerId)}</span>
                    {' eliminated '}
                    <span className="text-cyan-400 font-semibold">{getPlayerName(e.targetPlayerId)}</span>
                  </p>
                  <p className="text-orange-300 text-xs italic">"{e.disputeMessage}"</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleRestorePlayer(e)}
                      className="text-xs bg-green-700 hover:bg-green-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      ↩ Restore Player
                    </button>
                    <button
                      onClick={() => handleDismissDispute(e)}
                      className="text-xs bg-slate-600 hover:bg-slate-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      ✓ Elimination Stands
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
  const [showGameOverOverlay, setShowGameOverOverlay] = useState(true)

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
  const isAdmin = game?.adminUserId === userId

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-8">
      {/* Game Over Overlay */}
      {game?.status === 'ended' && showGameOverOverlay && (
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
              onClick={() => { setShowGameOverOverlay(false); setActiveTab('leaderboard') }}
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
            isAdmin={isAdmin}
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
