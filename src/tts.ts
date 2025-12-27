import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Subprocess, spawn } from "bun"
import OpenAI from "openai"
import { TTS_MODEL, TTS_VOICE, TTS_VOLUME } from "./config.ts"

const openai = new OpenAI()

export type Voice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "juniper"
  | "maple"
  | "marin"
  | "nova"
  | "onyx"
  | "sage"
  | "shimmer"
  | "verse"

let currentProcess: Subprocess | null = null
let currentAudioPath: string | null = null

/** Returns true if TTS is currently playing. */
export function isSpeaking(): boolean {
  return currentProcess !== null
}

/** Cancels any currently playing speech. */
export async function cancelSpeech(): Promise<void> {
  if (currentProcess) {
    currentProcess.kill()
    currentProcess = null
  }
  if (currentAudioPath) {
    await unlink(currentAudioPath).catch(() => {})
    currentAudioPath = null
  }
}

/** Generates speech audio and returns the path. Does not play it. */
export async function generateSpeech(
  text: string,
  voice: Voice = TTS_VOICE,
): Promise<string> {
  const response = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice,
    input: text,
    response_format: "wav",
  })

  const audioPath = join(tmpdir(), `spotify-dj-${Date.now()}.wav`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await Bun.write(audioPath, buffer)

  return audioPath
}

/**
 * Plays an audio file. Returns true if completed, false if cancelled.
 * Cleans up the file after playing.
 */
export async function playAudio(audioPath: string): Promise<boolean> {
  // Cancel any existing speech first
  await cancelSpeech()

  currentAudioPath = audioPath

  // Spawn afplay as a subprocess we can track and kill
  const proc = spawn(["afplay", "-v", String(TTS_VOLUME), audioPath], {
    stdout: "ignore",
    stderr: "ignore",
  })
  currentProcess = proc

  // Wait for it to finish
  const exitCode = await proc.exited
  const wasCompleted = exitCode === 0 && currentProcess === proc

  // Clean up
  currentProcess = null
  currentAudioPath = null
  await unlink(audioPath).catch(() => {})

  return wasCompleted
}

/**
 * Generates speech and plays it. Convenience wrapper.
 * Returns true if completed, false if cancelled/interrupted.
 */
export async function speakText(
  text: string,
  voice: Voice = TTS_VOICE,
): Promise<boolean> {
  const audioPath = await generateSpeech(text, voice)
  return playAudio(audioPath)
}
