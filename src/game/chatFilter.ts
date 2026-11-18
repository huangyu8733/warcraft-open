// The Gameplay tab's "Profanity Filter" — a light word filter over chat BODIES.
//
// OURS, and deliberately small: there is no word list in the install, and a heavy-handed
// replacement would mangle map names, URLs and non-English text. The list below is the short
// set of English words that show up in chat; each is matched as a whole word (so "assassin"
// and "class" survive) and replaced by the same number of asterisks. A filter for younger
// players (OPTION_TEEN) is a separate row and has no implementation here.

const WORDS = ["fuck", "fucking", "shit", "bitch", "asshole", "bastard", "dick", "cunt"];

const PATTERN = new RegExp(`\\b(${WORDS.join("|")})\\b`, "gi");

export function filterProfanity(text: string): string {
  return text.replace(PATTERN, (word) => "*".repeat(word.length));
}
