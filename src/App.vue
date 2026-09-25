<script setup>
import { nextTick, onMounted, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useAppStore } from "./stores/app-store.js";
import { usePersistedStore } from "./stores/persisted-store.js";
import { storeToRefs } from "pinia";
import { createProviderRegistry } from "./providers/registry.js";
import { createOpenAIProvider } from "./providers/openai-provider.js";
import { createAnthropicProvider } from "./providers/anthropic-provider.js";
import {
    initStorage,
    saveGame,
    loadGame as loadGameFromFS,
    listGames,
    deleteGame,
    addGameVersion,
    replaceGameVersion,
    undoGameVersion,
} from "./helpers/game-storage.js";
import UserInput from "./components/UserInput.vue";
import Settings from "./components/Settings.vue";
import GameList from "./components/GameList.vue";
import GameContainer from "./components/GameContainer.vue";
import { getChangePrompt, getFixPrompt, getSystemMessage } from "./helpers/prompts.js";
import { AnswerFormatError, safeParseGameJSON } from "./helpers/json-utils.js";
import { applyChanges, parseChangeAnswer } from "./helpers/change-blocks.js";

const appStore = useAppStore();
const persistedStore = usePersistedStore();
const { gameDescription, loadedGame, gameList, generating } = storeToRefs(appStore);
const { apiKey, selectedProvider, selectedModels } = storeToRefs(persistedStore);

// Set up provider registry with both providers
const registry = createProviderRegistry();
const openaiProvider = createOpenAIProvider();
const anthropicProvider = createAnthropicProvider();
registry.register(openaiProvider);
registry.register(anthropicProvider);

// Counts connects and disconnects. Claude's sign-in check takes a while,
// and meanwhile the user can pick another provider or press Disconnect.
// When a connect ends after a newer connect or a disconnect has started,
// its result is out of date and is ignored.
let connectionChanges = 0;

// Connect the selected provider. A provider that fails to connect is no
// longer active, so generating asks the user to open Settings. (OpenAI's
// connect fails only without an API key, which is checked first.)
async function connectActiveProvider() {
    const id = selectedProvider.value;
    if (id === "anthropic") {
        await connectClaude();
        return;
    }

    const change = ++connectionChanges;
    if (id === "openai" && apiKey.value) {
        const result = await openaiProvider.connect({ apiKey: apiKey.value });
        if (change !== connectionChanges) return;
        if (result.success) {
            registry.setActive("openai");
        }
    }
}

// Check Claude's sign-in, connect Claude if the CLI is signed in, and
// return the result. The Claude panel in Settings runs its sign-in check
// through this and shows the result. Running it here connects Claude even
// when the panel is closed before the check ends.
async function connectClaude() {
    const change = ++connectionChanges;
    const result = await anthropicProvider.connect();
    if (change === connectionChanges) {
        if (result.success) {
            registry.setActive("anthropic");
        } else {
            console.warn("Anthropic connect:", result.error);
            registry.deactivate("anthropic");
        }
    }
    return result;
}

// Disconnect a provider. It is then no longer active, so until another
// provider connects, generating asks the user to open Settings.
async function disconnectProvider(provider) {
    connectionChanges++;
    await provider.disconnect();
    registry.deactivate(provider.id);
}

// Re-connect when API key changes (OpenAI)
watch(apiKey, async () => {
    if (selectedProvider.value !== "openai") return;
    if (openaiProvider.isConnected()) {
        await disconnectProvider(openaiProvider);
    }
    await connectActiveProvider();
});

// Handle the user picking a provider in Settings
async function onProviderChanged(id) {
    // Disconnect previous provider if switching away
    const prev = registry.getActive();
    if (prev && prev.id !== id) {
        await disconnectProvider(prev);
    }

    // Settings then shows the Claude panel, which checks the sign-in
    // through connectClaude
    if (id === "anthropic") return;
    await connectActiveProvider();
}

// Handle the Disconnect button in Settings
async function onProviderDisconnected(id) {
    await disconnectProvider(registry.get(id));
}


const drawer = ref(false);
const showSettings = ref(false);

let game = ref({ id: "", prompts: [] });
// How many earlier versions the open game has, for Undo change
const earlierVersions = ref(0);
const undoing = ref(false);
// What the error banner's Retry does: the request that failed, again
const retry = shallowRef(null);
// Counts the games shown. Each game shown, and each version of it, gets a
// GameContainer of its own, which loads the game when mounted.
const gamesShown = ref(0);
const elapsedSeconds = ref(0);
let elapsedTimer = null;

function startElapsedTimer() {
    elapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => { elapsedSeconds.value++; }, 1000);
}

function stopElapsedTimer() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

// Ask a provider for a game, and return it. With no model given, the
// provider uses its default. With a parse function, the provider reads its
// answer with it, and what it reads is returned in place of a game.
async function requestGame(provider, prompt, model, parse) {
    const generator = provider.generateGame(prompt, {
        systemMessage: getSystemMessage(),
        model,
        maxTokens: 16384,
        temperature: 0.2,
        ...(parse && { parse }),
    });

    let jsonResponse = null;
    for await (const chunk of generator) {
        if (chunk.type === "complete") {
            jsonResponse = chunk.data;
        }
    }

    if (!jsonResponse) {
        throw new Error("No response from AI provider");
    }
    return jsonResponse;
}

// The game list's entry for a game
function listEntry(id, shown) {
    return {
        id,
        title: shown.title,
        description: shown.description,
        controls: shown.controls,
        rules: shown.rules,
    };
}

// Make a game the open game, and show it, with its number of earlier
// versions
function showGame(id, shown, versions) {
    game.value = shown;
    loadedGame.value = id;
    earlierVersions.value = versions;
    gamesShown.value++;
}

// Show a version of a game as the game storage returns it, and show it in
// the list too. Returns the game.
function showSavedGame(id, saved) {
    const result = safeParseGameJSON(saved.content);
    if (!result.ok) throw new Error(result.error);
    showGame(id, result.data, saved.changeRequests.length);
    gameList.value = gameList.value.map((item) => (item.id === id ? listEntry(id, result.data) : item));
    return result.data;
}

// Save a new game, with the user's prompt, and make it the game to show.
// Returns its id.
async function addGame(prompt, jsonResponse) {
    const timestamp = Date.now().toString();
    await saveGame({
        id: timestamp,
        prompt: JSON.stringify(prompt),
        content: JSON.stringify(jsonResponse),
    });

    showGame(timestamp, jsonResponse, 0);
    // The list shows the newest game first
    gameList.value.unshift(listEntry(timestamp, jsonResponse));
    return timestamp;
}

// The game generated or changed last, from when it is shown until it has
// had its one chance of a fix: its id, the user's prompt for a new game or
// request for a change, the game, and the provider and model that wrote it
let newGame = null;

// The error shown when no provider is connected
function showNoProvider() {
    state.value = "error";
    debugMessage.value = "No AI provider connected. Open Settings to connect.";
}

// Generate a new game using the active provider
const generateGame = async (prompt) => {
    retry.value = () => generateGame(prompt);
    const provider = registry.getActive();
    if (!provider) {
        showNoProvider();
        return;
    }

    state.value = "generating";
    generating.value = true;
    startElapsedTimer();

    try {
        const model = selectedModels.value[provider.id];
        const jsonResponse = await requestGame(provider, prompt, model);
        const id = await addGame(prompt, jsonResponse);
        newGame = { id, prompt, jsonResponse, provider, model };
        state.value = "done";
    } catch (error) {
        console.error("Failed to generate game:", error);
        state.value = "error";
        debugMessage.value = error.message || String(error);
    } finally {
        generating.value = false;
        stopElapsedTimer();
    }

    await nextTick();
};

// The requests a saved game was made from, oldest first: the description,
// which the game's file keeps as JSON, and each change
function requestsOf(saved) {
    let description = saved.prompt;
    try {
        description = JSON.parse(saved.prompt);
    } catch {
        // A description kept as it was typed
    }
    return [...(description && typeof description === "string" ? [description] : []), ...saved.changeRequests];
}

// Ask a provider to change a saved game, and return the changed game. The
// model answers with change blocks, which are made to the game. When they
// cannot be read or made, the model is asked once for the whole game,
// unless the user has left the game meanwhile: then null is returned.
async function requestChange(provider, model, id, saved, request) {
    const read = safeParseGameJSON(saved.content);
    if (!read.ok) throw new Error(read.error);
    const current = read.data;
    const requests = requestsOf(saved);

    try {
        const answer = await requestGame(provider, getChangePrompt(current, request, requests), model, parseChangeAnswer);
        const changed = applyChanges(current, answer);
        if (changed.ok) return changed.game;
        console.warn(`The changes could not be made (${changed.error}), so the whole game is asked for`);
    } catch (error) {
        // Only an answer that is not change blocks: a request that failed
        // fails the change
        if (!(error instanceof AnswerFormatError)) throw error;
        console.warn(`${error.message}, so the whole game is asked for`);
    }

    if (loadedGame.value !== id) return null;
    return requestGame(provider, getChangePrompt(current, request, requests, { wholeGame: true }), model);
}

// Change the open game as the user asks, with the provider and model
// selected now, and show the changed game, saved as the game's new version.
// The request holds the game as it is saved. While the change runs, the
// user can open another game, start a new one or delete this one: then the
// answer is dropped, and nothing is saved. A provider switch does not stop
// it: the change goes on with the provider it was sent to, as a new game
// does. With undoFirst, the game first goes back to its version before the
// last change: Retry does that when a changed game fails as it starts and
// cannot be fixed.
async function changeGame(request, { undoFirst = false } = {}) {
    const id = loadedGame.value;
    retry.value = () => changeGame(request, { undoFirst });
    const provider = registry.getActive();
    if (!provider) {
        showNoProvider();
        return;
    }

    newGame = null;
    state.value = "changing";
    generating.value = true;
    startElapsedTimer();

    try {
        if (undoFirst) {
            await undoGameVersion(id);
            retry.value = () => changeGame(request);
        }
        const saved = await loadGameFromFS(id);
        if (loadedGame.value !== id) return;
        earlierVersions.value = saved.changeRequests.length;
        const model = selectedModels.value[provider.id];
        const changed = await requestChange(provider, model, id, saved, request);
        if (loadedGame.value !== id) return;
        const version = await addGameVersion(id, changed, request);
        if (loadedGame.value !== id) return;
        const shown = showSavedGame(id, version);
        newGame = { id, request, jsonResponse: shown, provider, model };
        state.value = "done";
    } catch (error) {
        if (loadedGame.value !== id) return;
        console.error("Failed to change game:", error);
        state.value = "error";
        debugMessage.value = error.message || String(error);
    } finally {
        generating.value = false;
        stopElapsedTimer();
    }
}

// A new game or a changed game that fails as it starts goes back once, with
// the error, to the provider and model that wrote it. The fixed game takes
// the place of a new game, and of the version of a changed game. A game
// opened from the list or a fixed game does not, and neither does a game
// whose provider the user has since switched from or disconnected: the user
// sees its error, as with any game. If the fix fails, the user sees why, as
// when generating fails.
async function fixGame(error) {
    const broken = newGame;
    newGame = null;
    if (!broken || broken.id !== loadedGame.value || registry.getActive() !== broken.provider) return;

    state.value = "fixing";
    generating.value = true;
    startElapsedTimer();

    try {
        const fixed = await requestGame(broken.provider, getFixPrompt(broken.jsonResponse, error), broken.model);
        if (broken.request === undefined) {
            // The fixed game is saved first, then the broken game is
            // deleted, with any progress saved in it
            await addGame(broken.prompt, fixed);
            gameList.value = gameList.value.filter((item) => item.id !== broken.id);
            state.value = "done";
            await deleteGame(broken.id).catch((err) => console.warn("Failed to delete the game that was fixed:", err));
        } else {
            // A changed game stays the same game: the fixed game replaces
            // the version that failed, unless the user has left the game
            if (loadedGame.value !== broken.id) return;
            const version = await replaceGameVersion(broken.id, fixed);
            if (loadedGame.value !== broken.id) return;
            showSavedGame(broken.id, version);
            state.value = "done";
        }
    } catch (err) {
        if (broken.request !== undefined) {
            if (loadedGame.value !== broken.id) return;
            retry.value = () => changeGame(broken.request, { undoFirst: true });
        }
        console.error("Failed to fix game:", err);
        state.value = "error";
        debugMessage.value = err.message || String(err);
    } finally {
        generating.value = false;
        stopElapsedTimer();
    }
}

// "Undo change": go back to the open game's version before its last change.
// The version it goes back from is dropped, and the game's saved progress
// is deleted, as after a change.
async function undoChange() {
    const id = loadedGame.value;
    newGame = null;
    undoing.value = true;
    try {
        const version = await undoGameVersion(id);
        if (loadedGame.value !== id) return;
        showSavedGame(id, version);
        state.value = "done";
    } catch (error) {
        if (loadedGame.value !== id) return;
        console.error("Failed to undo the change:", error);
        retry.value = null;
        state.value = "error";
        debugMessage.value = error.message || String(error);
    } finally {
        undoing.value = false;
    }
}

// "New game": close the open game, so that the box makes a new game. A
// change or fix of it that is still running is dropped when it ends.
function closeGame() {
    newGame = null;
    loadedGame.value = null;
    earlierVersions.value = 0;
    state.value = "idle";
}

// Load selected game from filesystem and show it. While the file is being
// read, the user can open another game or delete this one; then neither this
// game nor an error reading it is shown. A game opened from the list gets no
// fix.
const loadGame = async (id) => {
    newGame = null;
    state.value = "loading";
    loadedGame.value = id;
    earlierVersions.value = 0;
    try {
        const item = await loadGameFromFS(id);
        if (loadedGame.value !== id) return;
        showSavedGame(id, item);
        state.value = "done";
    } catch (error) {
        if (loadedGame.value !== id) return;
        console.error("Failed to load game:", id, error);
        // A game that cannot be read is not open, so the box makes a new
        // game, and there is nothing to retry
        loadedGame.value = null;
        retry.value = null;
        state.value = "error";
        debugMessage.value = error.message || String(error);
    }
};

// When the user deletes the open game, take it off the screen, since its
// progress can no longer be saved. If the game is still being read, leave
// "Loading game...": loadGame will not show it. The same goes for a change
// or a fix of the game that is still running, which then saves nothing,
// and for an error. A new game being generated stays.
function onGameDeleted(id) {
    if (loadedGame.value !== id) return;
    loadedGame.value = null;
    earlierVersions.value = 0;
    if (state.value !== "generating") state.value = "idle";
}

const debugMessage = ref("");
const greetingMessage = `
    Welcome to Gaimer, your very own game generator assistant!
    Describe your idea of a game as detailed as possible, click the send button,
    then sit back and relax while the assistant generates your game ready to play!
`;

const state = ref("idle");
const gameStates = ref({
    idle: { message: greetingMessage },
    loading: { message: "Loading game..." },
});

onBeforeUnmount(() => { stopElapsedTimer(); });

onMounted(async () => {
    try {
        await initStorage();
        // Load game list after storage is ready
        if (gameList.value.length === 0) {
            gameList.value = await listGames();
        }
        await persistedStore.init();
        await connectActiveProvider();
    } catch (err) {
        console.warn("Startup error (non-fatal):", err);
    }
    // Show settings if no provider is connected
    if (!registry.getActive()) {
        showSettings.value = true;
    }
});

// Watch for new game descriptions from the user input. With a game open,
// the text is a request to change it.
watch(gameDescription, (newVal) => {
    if (gameDescription.value == "") {
        return;
    }

    if (loadedGame.value) {
        changeGame(gameDescription.value);
    } else {
        generateGame(gameDescription.value);
    }
    gameDescription.value = "";
});
</script>

<template>
    <q-layout view="hHh Lpr lfF" class="JetBrainsMono-font text-primary">
        <q-header class="safe-area-header">
            <q-toolbar class="bg-grey-10">
                <q-btn
                    flat
                    dense
                    round
                    icon="mdi-menu"
                    aria-label="Menu"
                    @click="drawer = !drawer"
                />
                <q-toolbar-title v-if="state === 'done'" class="text-subtitle2 ellipsis">
                    {{ game.title }}
                </q-toolbar-title>
                <q-space v-else />
                <q-btn
                    v-if="loadedGame && earlierVersions > 0"
                    flat
                    dense
                    no-caps
                    icon="mdi-undo"
                    label="Undo change"
                    :disable="generating"
                    :loading="undoing"
                    @click="undoChange"
                />
                <q-btn
                    v-if="loadedGame"
                    flat
                    dense
                    no-caps
                    icon="mdi-plus"
                    label="New game"
                    @click="closeGame"
                />
            </q-toolbar>
        </q-header>
        <q-drawer
            v-model="drawer"
            bordered
            overlay
            @click.stop="drawer = false"
        >
            <GameList @loadGame="loadGame" @gameDeleted="onGameDeleted" />

            <q-item v-ripple class="fixed-bottom q-pa-md">
                <q-item-section>
                </q-item-section>
                <q-item-section side>
                    <q-btn
                        flat
                        dense
                        round
                        icon="mdi-cog"
                        aria-label="Settings"
                        @click="showSettings = true"
                    />
                </q-item-section>
            </q-item>
        </q-drawer>

        <q-page-container>
            <q-page id="page" class="game-page">
                <Settings v-model="showSettings" :registry="registry" :connectClaude="connectClaude" @providerChanged="onProviderChanged" @providerDisconnected="onProviderDisconnected" />

                <div v-if="state !== 'done'" class="status-container">
                    <div class="text-center q-pa-md">
                        <!-- Idle / Loading -->
                        <template v-if="state === 'idle' || state === 'loading'">
                            {{ gameStates[state].message }}
                        </template>

                        <!-- Generating with timer -->
                        <template v-if="state === 'generating'">
                            <div class="text-body1 q-mb-sm">Generating game... ({{ elapsedSeconds }}s)</div>
                        </template>

                        <!-- Changing the open game, with timer -->
                        <template v-if="state === 'changing'">
                            <div class="text-body1 q-mb-sm">Changing the game... ({{ elapsedSeconds }}s)</div>
                        </template>

                        <!-- Fixing a new or changed game that failed as it started, with timer -->
                        <template v-if="state === 'fixing'">
                            <div class="text-body1 q-mb-sm">Fixing an error in the game... ({{ elapsedSeconds }}s)</div>
                        </template>

                        <q-spinner-gears
                            v-if="state === 'generating' || state === 'changing' || state === 'fixing' || state === 'loading'"
                            class="q-pa-lg"
                            color="primary"
                            size="8em"
                        />

                        <!-- Error with retry -->
                        <template v-if="state === 'error'">
                            <q-banner rounded class="bg-grey-9 text-white q-mb-md">
                                <template v-slot:avatar>
                                    <q-icon name="mdi-alert-circle" color="negative" />
                                </template>
                                {{ debugMessage }}
                            </q-banner>
                            <q-btn
                                v-if="retry"
                                outline
                                no-caps
                                color="grey-5"
                                label="Retry"
                                icon="mdi-refresh"
                                @click="retry()"
                            />
                        </template>
                    </div>
                </div>

                <!-- Each game shown, and each version of it, gets a GameContainer of its own, which loads the game when mounted -->
                <GameContainer
                    v-if="state === 'done'"
                    :key="gamesShown"
                    :game="game"
                    class="game-container-full"
                    @startError="fixGame"
                />
            </q-page>
        </q-page-container>
        <q-footer class="bg-grey-10 safe-area-footer">
            <UserInput />
        </q-footer>
    </q-layout>
</template>

<style>
/* Hide scrollbars on Macs (and WebKit based webviews)  */
::-webkit-scrollbar {
    display: none;
}
/* Hide scrollbars on Windows (in IE and Edge) */
body {
    overflow: auto;
    -ms-overflow-style: none;
}
/* Hide scrollbars in Firefox */
html {
    scrollbar-width: none;
}

/* iOS safe area support */
.safe-area-header {
    padding-top: var(--safe-area-top);
}
.safe-area-footer {
    padding-bottom: var(--safe-area-bottom);
}

/* Game page fills available space */
.game-page {
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.status-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}

.game-container-full {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

/* Prevent iOS rubber-banding on the game area */
.game-container-full iframe {
    touch-action: none;
    -webkit-overflow-scrolling: auto;
}
</style>
