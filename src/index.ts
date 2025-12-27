import { ANNOUNCEMENT_RETENTION_DAYS, DJ_SPEAKING_VOLUME } from "./config.ts"
import {
  cleanOldAnnouncements,
  getLastTrackId,
  initSchema,
  recordAnnouncement,
  setLastTrackId,
} from "./db.ts"
import { type DjContext, generateDjCommentary } from "./dj.ts"
import { getCurrentTrack, showNotification, withVolumeDip } from "./spotify.ts"
import { cancelSpeech, generateSpeech, isSpeaking, playAudio } from "./tts.ts"

initSchema()

console.log("Spotify DJ running...")
await showNotification("Spotify DJ started")

// Clean old announcements on startup
cleanOldAnnouncements(ANNOUNCEMENT_RETENTION_DAYS)

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...")
  await cancelSpeech()
  await showNotification("Spotify DJ stopped")
  process.exit(0)
})

process.on("SIGTERM", async () => {
  await cancelSpeech()
  process.exit(0)
})

/** Track info for the currently announcing track (for interruption context). */
let currentlyAnnouncingTrack: { name: string; artist: string } | null = null

// Run the DJ loop
await runDjLoop()

/** Main DJ loop - runs while process is alive. */
async function runDjLoop(): Promise<void> {
  while (true) {
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
