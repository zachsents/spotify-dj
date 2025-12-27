import { $ } from "bun"
import { FADE_DURATION_MS, FADE_STEPS } from "./config.ts"

export interface SpotifyTrack {
  id: string
  name: string
  artist: string
  album: string
  isPlaying: boolean
}

/** Fetches the current track from Spotify using AppleScript. */
export async function getCurrentTrack(): Promise<SpotifyTrack | null> {
  const script = `
    tell application "System Events"
      if not (exists process "Spotify") then
        return "NOT_RUNNING"
      end if
    end tell

    tell application "Spotify"
      if player state is not playing then
        return "NOT_PLAYING"
      end if
      
      set trackId to id of current track
      set trackName to name of current track
      set artistName to artist of current track
      set albumName to album of current track
      
      return trackId & "|||" & trackName & "|||" & artistName & "|||" & albumName
    end tell
  `

  const result = await $`osascript -e ${script}`.text()
  const output = result.trim()

  if (output === "NOT_RUNNING" || output === "NOT_PLAYING") {
    return null
  }

  const [id, name, artist, album] = output.split("|||")
  if (!id || !name || !artist) {
    return null
  }

  return { id, name, artist, album: album ?? "", isPlaying: true }
}

/** Shows a macOS notification. */
export async function showNotification(message: string): Promise<void> {
  await $`osascript -e ${`display notification "${message.replace(
    /"/g,
    '\\"',
  )}" with title "Spotify DJ"`}`
}

/** Check if Spotify app is running. */
export async function isSpotifyRunning(): Promise<boolean> {
  const script = `
    tell application "System Events"
      return exists process "Spotify"
    end tell
  `
  const result = await $`osascript -e ${script}`.text()
  return result.trim() === "true"
}

/** Get the current Spotify volume (0-100). */
export async function getSpotifyVolume(): Promise<number> {
  const script = `tell application "Spotify" to return sound volume`
  const result = await $`osascript -e ${script}`.text()
  return Number.parseInt(result.trim(), 10)
}

/** Set Spotify volume (0-100). */
export async function setSpotifyVolume(volume: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(volume)))
  await $`osascript -e ${`tell application "Spotify" to set sound volume to ${clamped}`}`
}

/** Smoothly fade volume from current to target over duration. */
async function fadeVolume(from: number, to: number): Promise<void> {
  const stepDuration = FADE_DURATION_MS / FADE_STEPS
  const volumeStep = (to - from) / FADE_STEPS

  for (let i = 1; i <= FADE_STEPS; i++) {
    await setSpotifyVolume(from + volumeStep * i)
    await Bun.sleep(stepDuration)
  }
}

/** Temporarily dip volume with smooth fade, run a callback, then restore. */
export async function withVolumeDip<T>(
  dipTo: number,
  fn: () => Promise<T>,
): Promise<T> {
  const originalVolume = await getSpotifyVolume()

  // Fade down
  await fadeVolume(originalVolume, dipTo)

  try {
    return await fn()
  } finally {
    // Fade back up
    await fadeVolume(dipTo, originalVolume)
  }
}
