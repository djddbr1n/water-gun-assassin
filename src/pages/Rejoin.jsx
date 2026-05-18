import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase.js'
import { setPlayerSession } from '../utils/gameLogic.js'

export default function Rejoin() {
  const { gameId, playerId } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    async function restore() {
      try {
        const [gameSnap, playerSnap] = await Promise.all([
          getDoc(doc(db, 'games', gameId)),
          getDoc(doc(db, 'games', gameId, 'players', playerId)),
        ])

        if (!gameSnap.exists() || !playerSnap.exists()) {
          setError('Game or player not found. The game may have ended.')
          return
        }

        const playerData = playerSnap.data()
        setPlayerSession(gameId, { playerId, name: playerData.name })

        const status = gameSnap.data().status
        if (status === 'lobby') {
          navigate(`/lobby/${gameId}`, { replace: true })
        } else {
          navigate(`/game/${gameId}`, { replace: true })
        }
      } catch (err) {
        console.error(err)
        setError('Failed to rejoin. Check your connection and try again.')
      }
    }
    restore()
  }, [gameId, playerId, navigate])

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
        <p className="text-red-400 text-lg mb-4">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="bg-cyan-500 hover:bg-cyan-400 text-white font-bold px-6 py-3 rounded-lg"
        >
          Go Home
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-cyan-400 text-xl animate-pulse">Rejoining your game...</p>
    </div>
  )
}
