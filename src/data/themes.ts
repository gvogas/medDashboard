// The themes: Notebook, the free plan's, and the six by field, which come with Term Pro in the
// app (src/data/plan.ts). What each one says and the few colours the code needs as values (the
// Settings swatches and the pictures). Every other colour is a CSS token per theme
// (styles/tokens.css, :root[data-bg="…"]). Values from the prototype's THEMES, STUDY, GOALS; the music's words from its lists() and themeWord.

export type Bg = "note" | "med" | "cs" | "law" | "pilot" | "sports" | "eng"
export const BGS: readonly Bg[] = ["note", "med", "cs", "law", "pilot", "sports", "eng"]

export interface ThemeInfo {
    label: string
    /** Settings' line under the name */
    desc: string
    /** light-mode accent and completed colour: the Settings swatch and the pictures */
    accent: string
    done: string
    /** "Goes on your coat" */
    wear: string
    /** the picture's accessible name */
    picture: string
    /** the phase word while studying: "On shift · round 1 of 4" */
    studyWord: string
    /** the third Quick start's name: "Anki then read" */
    preset: string
    /** the Music page's first card: "For the night shift", a Spotify search picked for the theme */
    music: { word: string; name: string; query: string }
    /** shown in the sidebar until the person saves quotes of their own */
    quote: { text: string; source: string }
}

export const THEMES: Record<Bg, ThemeInfo> = {
    note: { label: "Notebook", desc: "Spiral notebook and stickers · butter when done", accent: "#5B54C7", done: "#FFF3C4", wear: "notebook",
        picture: "Spiral notebook with your name on the label and stickers", studyWord: "Studying", preset: "Read then quiz",
        music: { word: "a cosy study session", name: "Study café", query: "study cafe lofi" },
        quote: { text: "The beautiful thing about learning is that nobody can take it away from you.", source: "B.B. King" } },
    med: { label: "Medicine", desc: "Lab coat · pink when done", accent: "#0F5F58", done: "#FBE8EF", wear: "coat",
        picture: "Lab coat with your name embroidered", studyWord: "On shift", preset: "Anki then read",
        music: { word: "the night shift", name: "Night shift", query: "night shift study" },
        quote: { text: "The good physician treats the disease; the great physician treats the patient.", source: "William Osler" } },
    cs: { label: "Computer Science", desc: "ID badge · mint when done", accent: "#2B4FA8", done: "#E3F1E8", wear: "badge",
        picture: "Lanyard ID badge with your name", studyWord: "Compiling", preset: "LeetCode then read",
        music: { word: "deep work", name: "Deep work", query: "deep work focus" },
        quote: { text: "Programs must be written for people to read, and only incidentally for machines to execute.", source: "Harold Abelson" } },
    law: { label: "Law", desc: "Suit and name plate · parchment when done", accent: "#7A2E2E", done: "#F4ECD6", wear: "name plate",
        picture: "Suit jacket with a brass name plate", studyWord: "In session", preset: "Brief then outline",
        music: { word: "library hours", name: "Library hours", query: "library study" },
        quote: { text: "The life of the law has not been logic: it has been experience.", source: "Oliver Wendell Holmes Jr." } },
    pilot: { label: "Aviation", desc: "Flight jacket · sky blue when done", accent: "#1F3A5F", done: "#DFEBF6", wear: "jacket",
        picture: "Flight jacket with wings and a name tape", studyWord: "In flight", preset: "Charts then sim",
        music: { word: "the cockpit", name: "Cruising altitude", query: "cruising altitude chill" },
        quote: { text: "The engine is the heart of an aeroplane, but the pilot is its soul.", source: "Walter Raleigh" } },
    sports: { label: "Sports", desc: "Jersey · peach when done", accent: "#2F6B3A", done: "#FCE8D8", wear: "jersey",
        picture: "Back of a jersey with your name and number", studyWord: "On the clock", preset: "Film then drills",
        music: { word: "game day", name: "Pre-game", query: "pre-game hype" },
        quote: { text: "Hard work beats talent when talent doesn’t work hard.", source: "Tim Notke" } },
    eng: { label: "Engineering", desc: "Hi-vis vest · yellow when done", accent: "#3F4E5E", done: "#FBF3C8", wear: "vest",
        picture: "Hi-vis safety vest with a name tag", studyWord: "Building", preset: "Problems then read",
        music: { word: "the workshop", name: "Workshop", query: "workshop focus" },
        quote: { text: "Scientists study the world as it is; engineers create the world that has never been.", source: "Theodore von Kármán" } },
}

export const GOALS: Record<Bg, readonly string[]> = {
    note: ["Dean's list", "Straight A's", "Graduate", "Top of the class", "Scholarship", "Grad school"],
    med: ["Neurologist", "Dermatologist", "Cardiologist", "Surgeon", "Pediatrician", "ER physician"],
    cs: ["Team lead", "Software engineer", "Data scientist", "Security engineer", "ML engineer", "Founder"],
    law: ["Litigator", "Judge", "Corporate lawyer", "Prosecutor", "Public defender", "Partner"],
    pilot: ["Captain", "First officer", "Airline pilot", "Flight instructor", "Fighter pilot", "Bush pilot"],
    sports: ["Pro athlete", "Team captain", "Head coach", "Physio", "Strength coach", "Sports scientist"],
    eng: ["Structural eng.", "Mechanical eng.", "Electrical eng.", "Project lead", "Chief engineer", "Aerospace eng."],
}

export const toBg = (v: unknown): Bg => (BGS.includes(v as Bg) ? (v as Bg) : "note")

/** The goal shown on the picture: the one saved in coat.role, else the theme's first. */
export const goalFor = (bg: Bg, role: string) => role.trim() || GOALS[bg][0]
