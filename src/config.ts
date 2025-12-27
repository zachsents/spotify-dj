/** Volume to dip Spotify to while DJ is speaking (0-100). */
export const DJ_SPEAKING_VOLUME = 50

/** Duration of volume fade in/out in milliseconds. */
export const FADE_DURATION_MS = 300

/** Number of steps for volume fade (higher = smoother). */
export const FADE_STEPS = 10

/** TTS model to use. */
export const TTS_MODEL = "gpt-4o-mini-tts"

/** Default TTS voice. */
export const TTS_VOICE = "marin"

/** TTS playback volume (0.0 to 1.0). */
export const TTS_VOLUME = 0.6

/** LLM model for DJ commentary. */
export const DJ_MODEL = "gpt-4.1-mini"

/** Temperature for DJ commentary generation. */
export const DJ_TEMPERATURE = 1

/** Max tokens for DJ commentary. */
export const DJ_MAX_TOKENS = 150

/** Number of recent announcements to use for context. */
export const DJ_HISTORY_COUNT = 5

/** Days to keep announcements before cleanup. */
export const ANNOUNCEMENT_RETENTION_DAYS = 30
