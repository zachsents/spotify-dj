import {
  appendFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
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

const PID_FILE = join(homedir(), ".config", "spotify-dj.pid")

/** Check if a process with given PID is running. */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Get all PIDs from the file, filtering out dead processes. */
function getAllDaemonPids(): number[] {
  if (!existsSync(PID_FILE)) return []

  const content = readFileSync(PID_FILE, "utf-8")
  const pids = content
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => !Number.isNaN(pid) && isProcessRunning(pid))

  // Rewrite file with only live PIDs
  if (pids.length > 0) {
    writeFileSync(PID_FILE, pids.join("\n"))
  } else {
    removePidFile()
  }

  return pids
}

/** Check if any daemon is running. */
function isAnyDaemonRunning(): boolean {
  return getAllDaemonPids().length > 0
}

/** Append a daemon PID to file. */
function appendDaemonPid(pid: number): void {
  appendFileSync(PID_FILE, `${pid}\n`)
}

/** Remove this process's PID from the file. */
function removeOwnPid(): void {
  const myPid = process.pid
  const pids = getAllDaemonPids().filter((pid) => pid !== myPid)

  if (pids.length > 0) {
    writeFileSync(PID_FILE, pids.join("\n"))
  } else {
    removePidFile()
  }
}

/** Remove PID file entirely. */
function removePidFile(): void {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE)
  }
}

/** Kill ALL daemon processes. */
function killAllDaemons(): void {
  const pids = getAllDaemonPids()

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Process already dead, ignore
    }
  }

  removePidFile()
}

// Check if we're running as daemon
const isDaemonMode = process.argv.includes("--daemon")

if (isDaemonMode) {
  // Running as background daemon - run the DJ loop
  initSchema()
  cleanOldAnnouncements(ANNOUNCEMENT_RETENTION_DAYS)
  await runDjLoop()
} else {
  // Toggle mode - check current state and toggle
  initSchema()

  const daemonRunning = isAnyDaemonRunning()

  if (daemonRunning) {
    // Turn off - kill ALL daemons
    killAllDaemons()
    await cancelSpeech()
    console.log("Off")
    await showNotification("Spotify DJ disabled")
  } else {
    // Turn on - spawn daemon process
    const scriptPath = process.argv[1]!

    const proc = Bun.spawn(["bun", scriptPath, "--daemon"], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    })

    // Append PID and detach
    appendDaemonPid(proc.pid)
    proc.unref()

    console.log("On")
    await showNotification("Spotify DJ enabled")
  }
}

/** Track info for the currently announcing track (for interruption context). */
let currentlyAnnouncingTrack: { name: string; artist: string } | null = null

/** Main DJ loop - runs until killed. */
async function runDjLoop(): Promise<void> {
  // Handle graceful shutdown
  process.on("SIGTERM", async () => {
    await cancelSpeech()
    removeOwnPid()
    process.exit(0)
  })

  process.on("SIGINT", async () => {
    await cancelSpeech()
    removeOwnPid()
    process.exit(0)
  })

  while (true) {
    const track = await getCurrentTrack()

    if (track) {
      const lastTrackId = getLastTrackId()

      if (track.id !== lastTrackId) {
        const wasInterrupted = isSpeaking()
        const interruptedTrack = currentlyAnnouncingTrack

        if (wasInterrupted) {
          await cancelSpeech()
        }

        setLastTrackId(track.id)
        currentlyAnnouncingTrack = { name: track.name, artist: track.artist }

        const djContext: DjContext = wasInterrupted
          ? { wasInterrupted: true, interruptedTrack: interruptedTrack! }
          : {}

        const commentary = await generateDjCommentary(
          {
            name: track.name,
            artist: track.artist,
            album: track.album,
          },
          djContext,
        )

        recordAnnouncement({
          trackId: track.id,
          trackName: track.name,
          artistName: track.artist,
          albumName: track.album,
          commentary,
        })

        const audioPath = await generateSpeech(commentary)
        await withVolumeDip(DJ_SPEAKING_VOLUME, () => playAudio(audioPath))

        currentlyAnnouncingTrack = null
      }
    }

    await Bun.sleep(1000)
  }
}
