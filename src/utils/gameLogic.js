import { v4 as uuidv4 } from 'uuid'

export function generateGameCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export function generateUserId() {
  return uuidv4()
}

export function getUserId() {
  let userId = localStorage.getItem('wga_userId')
  if (!userId) {
    userId = generateUserId()
    localStorage.setItem('wga_userId', userId)
  }
  return userId
}

export function getPlayerSession(gameId) {
  const raw = localStorage.getItem(`wga_game_${gameId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setPlayerSession(gameId, data) {
  localStorage.setItem(`wga_game_${gameId}`, JSON.stringify(data))
}

export function formTeams(players) {
  // Shuffle players randomly
  const shuffled = [...players].sort(() => Math.random() - 0.5)
  const n = shuffled.length
  const teams = []

  let teamSizes = []
  if (n % 3 === 0) {
    // All teams of 3
    for (let i = 0; i < n / 3; i++) teamSizes.push(3)
  } else if (n % 3 === 2) {
    // One team of 2, rest of 3
    teamSizes.push(2)
    for (let i = 0; i < (n - 2) / 3; i++) teamSizes.push(3)
  } else {
    // n % 3 === 1 → two teams of 2, rest of 3
    teamSizes.push(2)
    teamSizes.push(2)
    for (let i = 0; i < (n - 4) / 3; i++) teamSizes.push(3)
  }

  let idx = 0
  for (const size of teamSizes) {
    teams.push(shuffled.slice(idx, idx + size))
    idx += size
  }

  return teams
}

export function assignTargets(teamIds) {
  const targets = {}
  for (let i = 0; i < teamIds.length; i++) {
    targets[teamIds[i]] = teamIds[(i + 1) % teamIds.length]
  }
  return targets
}
