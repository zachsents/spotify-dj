import { ANNOUNCEMENT_RETENTION_DAYS, DJ_SPEAKING_VOLUME } from "./config.ts"
import {
  cleanOldAnnouncements,
  getLastTrackId,
  initSchema,
  isDjEnabled,
  recordAnnouncement,
  setDjEnabled,
  setLastTrackId,
} from "./db.ts"
import { type DjContext, generateDjCommentary } from "./dj.ts"
import { getCurrentTrack, showNotification, withVolumeDip } from "./spotify.ts"
import { cancelSpeech, generateSpeech, isSpeaking, playAudio } from "./tts.ts"

initSchema()

const wasEnabled = isDjEnabled()

if (wasEnabled) {
  // Turning off - also cancel any active speech
  await cancelSpeech()
  setDjEnabled(false)
  console.log("Off")
  await showNotification("Spotify DJ disabled")
} else {
  // Turning on
  setDjEnabled(true)
  console.log("On")
  await showNotification("Spotify DJ enabled")

  // Clean old announcements periodically
  cleanOldAnnouncements(ANNOUNCEMENT_RETENTION_DAYS)

  // Start the DJ loop
  runDjLoop()
}

/** Track info for the currently announcing track (for interruption context). */
let currentlyAnnouncingTrack: { name: string; artist: string } | null = null

/** Main DJ loop - runs in background checking for track changes. */
async function runDjLoop(): Promise<void> {
  while (isDjEnabled()) {
    const track = await getCurrentTrack()

    if (track) {
      const lastTrackId = getLastTrackId()

      if (track.id !== lastTrackId) {
        // Check if we're interrupting an ongoing announcement
        const wasInterrupted = isSpeaking()
        const interruptedTrack = currentlyAnnouncingTrack

        if (wasInterrupted) {
          await cancelSpeech()
        }

        setLastTrackId(track.id)
        currentlyAnnouncingTrack = { name: track.name, artist: track.artist }

        // Build context for the DJ
        const djContext: DjContext = wasInterrupted
          ? { wasInterrupted: true, interruptedTrack: interruptedTrack! }
          : {}

        // Generate the DJ commentary
        const commentary = await generateDjCommentary(
          {
            name: track.name,
            artist: track.artist,
            album: track.album,
          },
          djContext,
        )

        // Record in history
        recordAnnouncement({
          trackId: track.id,
          trackName: track.name,
          artistName: track.artist,
          albumName: track.album,
          commentary,
        })

        // Generate audio first (no volume dip during API call)
        const audioPath = await generateSpeech(commentary)

        // Only dip volume when ready to play
        await withVolumeDip(DJ_SPEAKING_VOLUME, () => playAudio(audioPath))

        currentlyAnnouncingTrack = null
      }
    }

    // Check every second
    await Bun.sleep(1000)
  }
}
