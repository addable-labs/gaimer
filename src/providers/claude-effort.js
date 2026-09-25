// The effort level of a Claude call for a game: the higher it is, the
// longer Claude thinks before it answers, and the longer a game takes.

// The levels the app offers, as the Claude CLI names them, and the one a
// call runs at when the user has chosen none. The CLI has two more, xhigh
// and max, which are slower still and were never timed.
export const CLAUDE_EFFORTS = ["low", "medium", "high"];
export const DEFAULT_CLAUDE_EFFORT = "low";

// How long a game usually takes with sonnet at each level, as timed with
// the app's command line and system prompt (Claude Code 2.1.282, one game
// per call): at low a Pong took 53 s and a Tetris 60 to 70 s, at medium 68 s
// and 3 min 51 s to 4 min 30 s, at high 3 min 14 s and 8 min 8 s. The other
// models were not timed.
const SONNET_WAITS = { low: "about a minute", medium: "1–5 minutes", high: "3–8 minutes" };

// The level a call runs at: the one chosen, or the default when none is
// chosen or the app does not offer the one chosen
export function effortToRun(chosen) {
    return CLAUDE_EFFORTS.includes(chosen) ? chosen : DEFAULT_CLAUDE_EFFORT;
}

// Whether a Claude model has effort levels: haiku has none, and the Claude
// CLI sends its calls without one, whatever level it is given
export function hasEffortLevels(model) {
    return model !== "haiku";
}

// How long a game usually takes with a model at the level chosen, or
// undefined when that was not timed
export function usualWait(model, effort) {
    return model === "sonnet" ? SONNET_WAITS[effortToRun(effort)] : undefined;
}
