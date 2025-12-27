import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

import {
  DJ_HISTORY_COUNT,
  DJ_MAX_TOKENS,
  DJ_MODEL,
  DJ_TEMPERATURE,
} from "./config.ts"
import { type Announcement, getRecentAnnouncements } from "./db.ts"

export interface DjContext {
  wasInterrupted?: boolean
  interruptedTrack?: { name: string; artist: string }
}

/**
 * Generates DJ commentary for a track based on history and context.
 * Focuses on the song title and interesting facts about the music.
 */
export async function generateDjCommentary(
  track: {
    name: string
    artist: string
    album: string
  },
  context: DjContext = {},
): Promise<string> {
  const recentAnnouncements = getRecentAnnouncements(DJ_HISTORY_COUNT)
  const historyContext = formatHistoryContext(recentAnnouncements)
  const interruptionContext = formatInterruptionContext(context)

  const { text } = await generateText({
    model: openai(DJ_MODEL),
    maxOutputTokens: DJ_MAX_TOKENS,
    temperature: DJ_TEMPERATURE,
    system: `You are a knowledgeable music DJ. Your job is to briefly introduce songs.

Guidelines:
- Keep it SHORT (1 sentence, under 15 words)
- Focus on the song title - always say it
- Only add a fact if you know something genuinely interesting about the song or artist (e.g., chart position, year released, notable collaboration, genre origin, fun trivia)
- If you don't know anything notable, just say the song title and artist simply
- NO flowery language, NO generic descriptions like "ethereal sounds" or "let this wash over you"
- NO telling people how to feel or what to experience
- Be informative, not poetic
- Don't use emojis

Examples of GOOD intros:
- "Here's 'Bohemian Rhapsody' by Queen, from 1975."
- "'Blinding Lights' by The Weeknd - biggest hit of 2020."
- "This is 'Dreams' by Fleetwood Mac."
- "'Uptown Funk' - Bruno Mars and Mark Ronson, 14 weeks at number one."

Examples of BAD intros (don't do this):
- "Let this ethereal track wash over you..."
- "Feel the vibes of this incredible journey..."
- "Get ready to be transported..."

${historyContext}
${interruptionContext}`,
    prompt: `Introduce "${track.name}" by ${track.artist}${
      track.album ? ` (album: "${track.album}")` : ""
    }.`,
  })

  return text.trim()
}

function formatHistoryContext(announcements: Announcement[]): string {
  if (announcements.length === 0) {
    return ""
  }

  const lines = announcements.map(
    (a, i) =>
      `${i + 1}. "${a.trackName}" by ${a.artistName} - Your intro: "${
        a.commentary
      }"`,
  )

  return `Recent intros (avoid repeating yourself):
${lines.join("\n")}`
}

function formatInterruptionContext(context: DjContext): string {
  if (!context.wasInterrupted || !context.interruptedTrack) {
    return ""
  }

  return `
You were just cut off. Briefly acknowledge it (e.g., "Okay, moving on!" or "Alright!") then introduce the new song.`
}
