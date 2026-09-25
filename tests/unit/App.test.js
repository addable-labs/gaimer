import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtn, QBtnToggle, QSpinnerGears } from 'quasar'
import App from '../../src/App.vue'
import Settings from '../../src/components/Settings.vue'
import ConnectClaude from '../../src/components/ConnectClaude.vue'
import GameList from '../../src/components/GameList.vue'
import GameContainer from '../../src/components/GameContainer.vue'
import {
  listGames,
  loadGame as loadGameFromFS,
  saveGame,
  deleteGame as deleteGameFromFS,
  addGameVersion,
  replaceGameVersion,
  undoGameVersion,
} from '../../src/helpers/game-storage.js'
import { AnswerFormatError, safeParseGameJSON } from '../../src/helpers/json-utils.js'
import { parseChangeAnswer } from '../../src/helpers/change-blocks.js'
import { getChangePrompt, getFixPrompt } from '../../src/helpers/prompts.js'
import { quasarPlugins } from '../../src/quasar-plugins.js'
import { useAppStore } from '../../src/stores/app-store.js'
import { usePersistedStore } from '../../src/stores/persisted-store.js'
import { gameScript } from '../game-page.js'
import { shell } from '../plugin-shell.js'

// Stand-ins for the two providers, so that no test runs the Claude CLI or calls OpenAI
const providers = vi.hoisted(() => ({}))
vi.mock('../../src/providers/openai-provider.js', () => ({
  createOpenAIProvider: () => providers.openai,
}))
vi.mock('../../src/providers/anthropic-provider.js', () => ({
  createAnthropicProvider: () => providers.anthropic,
}))

// Runs commands as the shell plugin would under the app's capability
vi.mock('@tauri-apps/plugin-shell', () => import('../plugin-shell.js'))

// A file system in memory, by path: the game folder, and the temp files the
// Claude provider writes for a game generation
const files = vi.hoisted(() => new Map())
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async () => true),
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async (path, text) => { files.set(path, text) }),
  readTextFile: vi.fn(async (path) => {
    if (!files.has(path)) throw new Error(`No such file: ${path}`)
    return files.get(path)
  }),
  readDir: vi.fn(async (dir) => [...files.keys()]
    .filter((path) => path.slice(0, path.lastIndexOf('/')) === dir)
    .map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1), isFile: true }))),
  remove: vi.fn(async (path) => { files.delete(path) }),
}))
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => '/Users/player'),
  tempDir: vi.fn(async () => '/tmp'),
  join: vi.fn(async (...parts) => parts.join('/')),
}))

// The game folder
const gamesFolder = '/Users/player/Library/Mobile Documents/com~apple~CloudDocs/Gaimer'

// A fresh credential store for each test, so that no API key carries over
const credentials = vi.hoisted(() => new Map())
vi.mock('../../src/credentials/credential-store.js', () => ({
  createCredentialStore: () => ({
    importOldVault: async () => {},
    get: async (providerId, key) => credentials.get(`${providerId}:${key}`) ?? null,
    set: async (providerId, key, value) => { credentials.set(`${providerId}:${key}`, value) },
    remove: async (providerId, key) => { credentials.delete(`${providerId}:${key}`) },
  }),
}))

// The game storage, on the file system in memory, with each of its
// functions watched
vi.mock('../../src/helpers/game-storage.js', async (importOriginal) => {
  const storage = await importOriginal()
  return Object.fromEntries(Object.entries(storage).map(([name, fn]) => [name, vi.fn(fn)]))
})

// Reads a provider's answer as the real providers do: as a game, or with the
// caller's parse function. A game or other object stands for its JSON.
function readAnswer(answer, options) {
  const result = (options?.parse ?? safeParseGameJSON)(typeof answer === 'string' ? answer : JSON.stringify(answer))
  if (!result.ok) throw new AnswerFormatError(result.error)
  return result.data
}

// Like the real providers: a failed connect() leaves the provider not
// connected, and generateGame() throws unless the provider is connected
function fakeProvider(id) {
  let connected = false
  const provider = {
    id,
    canConnect: true,
    connect: vi.fn(async () => {
      if (!provider.canConnect) {
        connected = false
        return { success: false, error: 'Not logged in' }
      }
      connected = true
      return { success: true }
    }),
    disconnect: vi.fn(async () => { connected = false }),
    isConnected: () => connected,
    generateGame: vi.fn(async function* (prompt, options) {
      if (!connected) throw new Error('Provider not connected')
      yield { type: 'complete', data: readAnswer({ title: 'Pong', code: 'draw()' }, options) }
    }),
  }
  return provider
}

// What the Claude CLI prints, given the arguments of the login shell that
// runs it: it is installed and signed in, and answers with a game of Pong
function claudeCli({ args }) {
  const line = args[2]
  if (line === 'exec claude --version') return '2.1.281 (Claude Code)\n'
  if (line === 'exec claude auth status') return JSON.stringify({ loggedIn: true }, null, 2)
  const game = { title: 'Pong', code: 'draw()' }
  return JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(game) }) + '\n'
}

// How many times the app ran a command line in a login shell
function timesRun(line) {
  return shell.ran.filter(({ args }) => args[2] === line).length
}

// End a command line that is still running in a login shell
function endRun(line) {
  shell.running.find(({ process }) => process.args[2] === line).exit()
}

// Starts the app, with the Quasar plugins it installs. Settings is stubbed
// unless other stubs are given: with {}, Settings and its Claude panel are
// real.
async function startApp(stubs = { Settings: true }, options = {}) {
  const wrapper = mount(App, {
    ...options,
    global: {
      plugins: [[Quasar, { plugins: quasarPlugins }]],
      stubs: { GameList: true, GameContainer: true, UserInput: true, ...stubs },
    },
  })
  await flushPromises()
  return wrapper
}

// Starts the app with its game container, in the page, where the game's
// iframe has a window to send the app messages from
function startAppWithGames() {
  return startApp({ Settings: true, GameContainer: false }, { attachTo: document.body })
}

// What Settings does when the user picks a provider
async function switchProvider(wrapper, id) {
  usePersistedStore().selectedProvider = id
  wrapper.findComponent(Settings).vm.$emit('providerChanged', id)
  await flushPromises()
}

async function generate() {
  useAppStore().gameDescription = 'A game of pong'
  await flushPromises()
}

// The user sends a request from the box
async function send(request) {
  useAppStore().gameDescription = request
  await flushPromises()
}

function modelSentTo(provider) {
  return provider.generateGame.mock.lastCall[1].model
}

// Open Settings from the drawer
async function openSettings(wrapper) {
  await wrapper.find('[aria-label="Settings"]').trigger('click')
  await flushPromises()
}

// Open Settings from the drawer and return its Claude panel (Claude must be selected)
async function openClaudePanel(wrapper) {
  await openSettings(wrapper)
  return wrapper.findComponent(ConnectClaude)
}

// The user picks a provider in Settings, which must be open and not stubbed
async function pickProvider(wrapper, id) {
  wrapper.findComponent(QBtnToggle).vm.$emit('update:modelValue', id)
  await flushPromises()
}

function button(wrapper, label) {
  return wrapper.findAllComponents(QBtn).find((btn) => btn.props('label') === label)
}

// Keep Claude's next sign-in check running until the test ends it
function holdClaudeConnect() {
  const connect = providers.anthropic.connect.getMockImplementation()
  let finish
  providers.anthropic.connect.mockImplementationOnce(
    () => new Promise((resolve) => { finish = () => resolve(connect()) })
  )
  return () => finish()
}

// Keep Claude's next game generation running until the test ends it
function holdClaudeGeneration() {
  const generateGame = providers.anthropic.generateGame.getMockImplementation()
  let finish
  const finished = new Promise((resolve) => { finish = resolve })
  providers.anthropic.generateGame.mockImplementationOnce(async function* (...args) {
    await finished
    yield* generateGame(...args)
  })
  return () => finish()
}

// What GameList tells App once the user has deleted a game
async function deleteGame(wrapper, id) {
  wrapper.findComponent(GameList).vm.$emit('gameDeleted', id)
  await flushPromises()
}

// Puts a game in the game folder, whose code calls a function named after it
function addSavedGame(id, title) {
  const game = { title, code: `${title.toLowerCase()}()` }
  files.set(`${gamesFolder}/${id}-${title.toLowerCase()}.json`, JSON.stringify({ ...game, id, prompt: JSON.stringify(`A game of ${title}`) }))
}

// The game folder's files, by name, with their data
function gameFiles() {
  return Object.fromEntries([...files]
    .filter(([path]) => path.startsWith(`${gamesFolder}/`))
    .map(([path, text]) => [path.slice(gamesFolder.length + 1), JSON.parse(text)]))
}

// What GameList tells App when the user picks a game in the list
async function openGame(wrapper, id) {
  wrapper.findComponent(GameList).vm.$emit('loadGame', id)
  await flushPromises()
}

// Keep the next read of a saved game running until the test ends it
function holdGameRead() {
  const read = loadGameFromFS.getMockImplementation()
  let finish
  loadGameFromFS.mockImplementationOnce(
    (id) => new Promise((resolve) => { finish = () => resolve(read(id)) })
  )
  return () => finish()
}

// The script of the game running on screen, which holds the game's code
function gameOnScreen(wrapper) {
  return gameScript(wrapper.find('iframe').element.srcdoc)
}

// Sends a message from the game on screen to the app, as its page does, and
// lets the app act on it
async function sendFromGame(wrapper, message) {
  const game = wrapper.find('iframe').element.contentWindow
  window.dispatchEvent(new MessageEvent('message', { data: message, source: game }))
  await flushPromises()
}

// The text of the notifications shown
function notifications() {
  return [...document.querySelectorAll('.q-notification')].map((n) => n.textContent).join()
}

// The provider answers its next request when the test calls the function
// returned, with the answer: a game, change blocks, or other text, which it
// reads as the real providers do. By the clock, answering takes the model a
// minute.
function answerLater(provider, answer) {
  let finish
  const finished = new Promise((resolve) => { finish = resolve })
  provider.generateGame.mockImplementationOnce(async function* (prompt, options) {
    await finished
    vi.setSystemTime(Date.now() + 60_000)
    yield { type: 'complete', data: readAnswer(answer, options) }
  })
  return () => finish()
}

// The provider answers its next request with the answer
function answerWith(provider, answer) {
  answerLater(provider, answer)()
}

// The user presses New game in the toolbar
async function pressNewGame(wrapper) {
  await button(wrapper, 'New game').trigger('click')
  await flushPromises()
}

enableAutoUnmount(afterEach)

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    credentials.clear()
    files.clear()
    vi.clearAllMocks()
    providers.openai = fakeProvider('openai')
    providers.anthropic = fakeProvider('anthropic')
    shell.ran = []
    shell.output = claudeCli
    shell.exits = () => true
    shell.running = []
    shell.killed = []
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('model choice', () => {
    it('generates with the model chosen for the active provider', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      const wrapper = await startApp()
      const { selectedModels } = usePersistedStore()
      selectedModels.openai = 'gpt-4o'
      selectedModels.anthropic = 'claude-opus-4-6'

      await generate()
      expect(modelSentTo(providers.anthropic)).toBe('claude-opus-4-6')

      await switchProvider(wrapper, 'openai')
      await pressNewGame(wrapper)
      await generate()
      expect(modelSentTo(providers.openai)).toBe('gpt-4o')
    })

    it('leaves the model to the provider when none is chosen', async () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      await startApp()

      await generate()
      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
      expect(modelSentTo(providers.anthropic)).toBeFalsy()
    })

    it('does not send Claude a model picked for OpenAI before the update', async () => {
      // What the app saved when a user picked gpt-4o for OpenAI, then switched to Claude
      credentials.set('openai:apiKey', 'sk-test')
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      localStorage.setItem('selectedModel', JSON.stringify('gpt-4o'))
      const wrapper = await startApp()

      await generate()
      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
      expect(modelSentTo(providers.anthropic)).not.toBe('gpt-4o')

      await switchProvider(wrapper, 'openai')
      await pressNewGame(wrapper)
      await generate()
      expect(modelSentTo(providers.openai)).toBe('gpt-4o')
    })
  })

  describe('active provider', () => {
    it('has none after switching to OpenAI with no API key', async () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      const wrapper = await startApp()

      await switchProvider(wrapper, 'openai')
      await generate()

      expect(wrapper.text()).toContain('No AI provider connected. Open Settings to connect.')
    })

    it('has none when the selected provider fails to connect again', async () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      const wrapper = await startApp({})

      // Opening Settings shows the Claude panel, which has Claude's sign-in
      // checked again, but Claude is now signed out
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      providers.anthropic.canConnect = false
      await openClaudePanel(wrapper)
      await generate()

      expect(wrapper.text()).toContain('No AI provider connected. Open Settings to connect.')
      expect(providers.anthropic.generateGame).not.toHaveBeenCalled()
    })

    it('has none after the user disconnects Claude in Settings', async () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      const wrapper = await startApp({ ConnectClaude: true })

      // The user presses Disconnect in the Claude panel
      const panel = await openClaudePanel(wrapper)
      panel.vm.$emit('disconnected')
      await flushPromises()
      await generate()

      expect(wrapper.text()).toContain('No AI provider connected. Open Settings to connect.')
      expect(providers.anthropic.generateGame).not.toHaveBeenCalled()
      expect(providers.anthropic.disconnect).toHaveBeenCalledOnce()
    })

    it('stays OpenAI when Claude fails to connect after the user switched back', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      const wrapper = await startApp({})
      await openSettings(wrapper)

      // Claude's sign-in check is still running when the user switches back
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const finishClaudeConnect = holdClaudeConnect()
      await pickProvider(wrapper, 'anthropic')
      await pickProvider(wrapper, 'openai')
      providers.anthropic.canConnect = false
      finishClaudeConnect()
      await flushPromises()
      await generate()

      expect(providers.openai.generateGame).toHaveBeenCalledOnce()
    })

    it('stays OpenAI when Claude connects after the user switched back', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      const wrapper = await startApp({})
      await openSettings(wrapper)

      // Claude's sign-in check is still running when the user switches back
      const finishClaudeConnect = holdClaudeConnect()
      await pickProvider(wrapper, 'anthropic')
      await pickProvider(wrapper, 'openai')
      finishClaudeConnect()
      await flushPromises()
      await generate()

      expect(providers.openai.generateGame).toHaveBeenCalledOnce()
      expect(providers.anthropic.generateGame).not.toHaveBeenCalled()
    })

    it('stays OpenAI when the user switches back while the Claude panel checks the CLI', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      const wrapper = await startApp({})
      await openSettings(wrapper)

      // The panel's check that the CLI is installed ends after the user
      // has switched back
      shell.exits = ({ args }) => args[2] !== 'exec claude --version'
      await pickProvider(wrapper, 'anthropic')
      await pickProvider(wrapper, 'openai')
      endRun('exec claude --version')
      await flushPromises()
      await generate()

      expect(providers.openai.generateGame).toHaveBeenCalledOnce()
      expect(providers.anthropic.generateGame).not.toHaveBeenCalled()
    })

    it('has none when Claude connects after the user disconnected it', async () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))

      // The sign-in check at startup is still running when the user opens
      // Settings, where the Claude panel's check finds the CLI signed in.
      // The user presses Disconnect before the first check ends.
      const finishStartupCheck = holdClaudeConnect()
      const wrapper = await startApp({})
      const panel = await openClaudePanel(wrapper)
      await button(panel, 'Disconnect').trigger('click')
      await flushPromises()
      finishStartupCheck()
      await flushPromises()
      await generate()

      expect(wrapper.text()).toContain('No AI provider connected. Open Settings to connect.')
      expect(providers.anthropic.generateGame).not.toHaveBeenCalled()
    })

    it('is OpenAI once the user saves an API key, and uses a new key as soon as it is saved', async () => {
      const wrapper = await startApp()

      // What Settings does when the user saves a key
      usePersistedStore().apiKey = 'sk-first'
      await flushPromises()
      await generate()

      expect(providers.openai.connect).toHaveBeenLastCalledWith({ apiKey: 'sk-first' })
      expect(providers.openai.generateGame).toHaveBeenCalledOnce()

      usePersistedStore().apiKey = 'sk-second'
      await flushPromises()
      await pressNewGame(wrapper)
      await generate()

      expect(providers.openai.disconnect).toHaveBeenCalledOnce()
      expect(providers.openai.connect).toHaveBeenLastCalledWith({ apiKey: 'sk-second' })
      expect(providers.openai.generateGame).toHaveBeenCalledTimes(2)
    })
  })

  describe('Claude sign-in check', () => {
    it('runs once when the user picks Claude in Settings', async () => {
      // The real Claude provider, which runs its sign-in check through the
      // shell plugin
      const { createAnthropicProvider } = await vi.importActual('../../src/providers/anthropic-provider.js')
      providers.anthropic = createAnthropicProvider()
      // No provider is connected, so Settings opens
      const wrapper = await startApp({})

      await pickProvider(wrapper, 'anthropic')

      // The Claude panel checks that the CLI is installed, and the sign-in
      // is checked once
      expect(timesRun('exec claude --version')).toBe(1)
      expect(timesRun('exec claude auth status')).toBe(1)
      expect(wrapper.findComponent(ConnectClaude).text()).toContain('Connected')

      // Claude is connected and generates the game
      await generate()
      expect(wrapper.findComponent(GameContainer).props('game').title).toBe('Pong')
    })

    it('connects Claude when Settings is closed before the check ends', async () => {
      const wrapper = await startApp({})

      // The user picks Claude and closes Settings while the sign-in check is
      // still running
      const finishClaudeConnect = holdClaudeConnect()
      await pickProvider(wrapper, 'anthropic')
      await button(wrapper, 'Close').trigger('click')
      await flushPromises()
      expect(wrapper.findComponent(ConnectClaude).exists()).toBe(false)
      finishClaudeConnect()
      await flushPromises()
      await generate()

      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
    })
  })

  // A game can take Claude several minutes to write
  describe('time limit of a Claude call', () => {
    // A game as Claude writes it, calling a function it has not defined
    const pong = { title: 'Pong', code: 'drawBall()' }

    beforeEach(async () => {
      // The real Claude provider, which runs the Claude CLI through the shell
      // plugin
      const { createAnthropicProvider } = await vi.importActual('../../src/providers/anthropic-provider.js')
      providers.anthropic = createAnthropicProvider()
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.useFakeTimers()
    })

    // The Claude CLI answers the app's calls for a game with these answers,
    // in order: games, or other text. The calls after them get no answer, and
    // run on.
    function claudeAnswers(...answers) {
      const answered = new Set()
      const isGameCall = ({ args }) => args[2].startsWith('exec claude -p ')
      shell.output = (process) => {
        if (!isGameCall(process)) return claudeCli(process)
        if (answers.length === 0) return ''
        answered.add(process)
        const answer = answers.shift()
        const result = typeof answer === 'string' ? answer : JSON.stringify(answer)
        return JSON.stringify({ type: 'result', is_error: false, result }) + '\n'
      }
      shell.exits = (process) => !isGameCall(process) || answered.has(process)
    }

    // The prompt of the call that runs on, which the provider wrote to a temp
    // file for the Claude CLI to read
    function runningPrompt() {
      const [{ process }] = shell.running
      return files.get(process.args[2].match(/< '(.+)'$/)[1])
    }

    // The call that runs on is stopped once it has run for 15 minutes, and
    // not before, and the app says why
    async function expectStoppedAfter15Minutes(wrapper) {
      const [{ process }] = shell.running
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1)
      expect(shell.killed).toEqual([])
      expect(wrapper.text()).not.toContain('Command timed out')

      await vi.advanceTimersByTimeAsync(1)
      expect(shell.killed).toEqual([process])
      expect(wrapper.text()).toContain('Command timed out')
    }

    it('is 15 minutes for a new game', async () => {
      claudeAnswers()
      const wrapper = await startApp()
      await generate()
      expect(runningPrompt()).toBe('A game of pong')

      await expectStoppedAfter15Minutes(wrapper)
    })

    it('is 15 minutes for the fix of a new game that fails as it starts', async () => {
      claudeAnswers(pong)
      const wrapper = await startAppWithGames()
      await generate()
      const startError = { message: "Can't find variable: drawBall", stack: 'global code@game.js:1:1' }
      await sendFromGame(wrapper, { type: 'error', data: startError })
      expect(runningPrompt()).toBe(getFixPrompt(pong, startError))

      await expectStoppedAfter15Minutes(wrapper)
    })

    it('is 15 minutes for a change', async () => {
      claudeAnswers(pong)
      const wrapper = await startApp()
      await generate()
      await send('Make the ball faster')
      expect(runningPrompt()).toBe(getChangePrompt(pong, 'Make the ball faster', ['A game of pong']))

      await expectStoppedAfter15Minutes(wrapper)
    })

    it('is 15 minutes for the whole game, asked for when the answer to a change is not change blocks', async () => {
      claudeAnswers(pong, 'Here are the changes: the ball is faster')
      const wrapper = await startApp()
      await generate()
      await send('Make the ball faster')
      expect(runningPrompt()).toBe(getChangePrompt(pong, 'Make the ball faster', ['A game of pong'], { wholeGame: true }))

      await expectStoppedAfter15Minutes(wrapper)
    })
  })

  describe('game list', () => {
    beforeEach(() => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
    })

    it('puts a new game at the top, where the list shows the newest game', async () => {
      listGames.mockResolvedValueOnce([
        { id: '200', title: 'Snake' },
        { id: '100', title: 'Tetris' },
      ])
      await startApp()

      await generate()

      expect(useAppStore().gameList.map((game) => game.title)).toEqual(['Pong', 'Snake', 'Tetris'])
    })

    it('goes back to the start screen when the open game is deleted', async () => {
      const wrapper = await startApp()
      await generate()
      expect(wrapper.findComponent(GameContainer).exists()).toBe(true)

      await deleteGame(wrapper, useAppStore().loadedGame)

      expect(wrapper.findComponent(GameContainer).exists()).toBe(false)
      expect(wrapper.text()).toContain('Welcome to Gaimer')
      expect(useAppStore().loadedGame).toBeNull()
    })

    it('keeps the open game when another game is deleted', async () => {
      listGames.mockResolvedValueOnce([{ id: '100', title: 'Tetris' }])
      const wrapper = await startApp()
      await generate()
      const openGame = useAppStore().loadedGame

      await deleteGame(wrapper, '100')

      expect(wrapper.findComponent(GameContainer).exists()).toBe(true)
      expect(useAppStore().loadedGame).toBe(openGame)
    })

    it('keeps generating a new game when the game that was open is deleted', async () => {
      const wrapper = await startApp()
      await generate()
      const openGame = useAppStore().loadedGame

      const finishGenerating = holdClaudeGeneration()
      await pressNewGame(wrapper)
      await generate()
      await deleteGame(wrapper, openGame)
      expect(wrapper.text()).toContain('Generating game...')

      finishGenerating()
      await flushPromises()
      expect(wrapper.findComponent(GameContainer).exists()).toBe(true)
    })
  })

  describe('a new game retried while a saved game is open', () => {
    beforeEach(() => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('keeps generating when that game is deleted', async () => {
      addSavedGame('100', 'Tetris')
      const wrapper = await startApp()

      // The new game fails after the user has opened a saved game, and the
      // user retries it
      let fail
      const failed = new Promise((resolve) => { fail = resolve })
      providers.anthropic.generateGame.mockImplementationOnce(async function* () {
        await failed
        throw new Error('Claude CLI error: rate limited')
      })
      await generate()
      await openGame(wrapper, '100')
      fail()
      await flushPromises()
      const finishGenerating = holdClaudeGeneration()
      await button(wrapper, 'Retry').trigger('click')
      await flushPromises()

      await deleteGame(wrapper, '100')
      expect(wrapper.text()).toContain('Generating game...')

      finishGenerating()
      await flushPromises()
      expect(wrapper.findComponent(GameContainer).props('game').title).toBe('Pong')
    })
  })

  describe('opening a saved game', () => {
    beforeEach(() => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
    })

    it('shows the game as soon as it has been read', async () => {
      addSavedGame('100', 'Tetris')
      const wrapper = await startApp()

      await openGame(wrapper, '100')

      expect(wrapper.text()).not.toContain('Loading game...')
      expect(wrapper.findComponent(GameContainer).props('game').title).toBe('Tetris')
    })

    it('runs each game opened, and then a new game that finishes generating', async () => {
      addSavedGame('100', 'Tetris')
      addSavedGame('200', 'Snake')
      const wrapper = await startApp({ Settings: true, GameContainer: false })

      // The user plays saved games while a new one is being generated
      const finishGenerating = holdClaudeGeneration()
      await generate()
      await openGame(wrapper, '100')
      expect(gameOnScreen(wrapper)).toContain('tetris()')
      await openGame(wrapper, '200')
      expect(gameOnScreen(wrapper)).toContain('snake()')

      finishGenerating()
      await flushPromises()

      // The new game, whose code is draw(), runs in place of the game that was open
      expect(wrapper.findAll('iframe')).toHaveLength(1)
      expect(gameOnScreen(wrapper)).toContain('draw()')
      expect(gameOnScreen(wrapper)).not.toContain('snake()')
    })

    it('shows the game opened last when an earlier one takes longer to read', async () => {
      addSavedGame('100', 'Tetris')
      addSavedGame('200', 'Snake')
      const wrapper = await startApp()

      const finishReadingTetris = holdGameRead()
      await openGame(wrapper, '100')
      await openGame(wrapper, '200')
      finishReadingTetris()
      await flushPromises()

      expect(wrapper.findComponent(GameContainer).props('game').title).toBe('Snake')
      expect(useAppStore().loadedGame).toBe('200')
    })

    it('does not show a game deleted while it was being read', async () => {
      addSavedGame('100', 'Tetris')
      const wrapper = await startApp()

      const finishReading = holdGameRead()
      await openGame(wrapper, '100')
      expect(wrapper.text()).toContain('Loading game...')
      await deleteGame(wrapper, '100')
      finishReading()
      await flushPromises()

      expect(wrapper.findComponent(GameContainer).exists()).toBe(false)
      expect(wrapper.text()).toContain('Welcome to Gaimer')
    })

    it('shows no error when a game is deleted before it could be read', async () => {
      addSavedGame('100', 'Tetris')
      const wrapper = await startApp()

      const finishReading = holdGameRead()
      await openGame(wrapper, '100')
      // The game's file is gone by the time it is read
      files.delete(`${gamesFolder}/100-tetris.json`)
      await deleteGame(wrapper, '100')
      finishReading()
      await flushPromises()

      expect(wrapper.text()).not.toContain('Game not found')
      expect(wrapper.text()).toContain('Welcome to Gaimer')
    })

    it('shows why a saved game cannot be opened', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // A game file with no title
      files.set(`${gamesFolder}/100-untitled.json`, JSON.stringify({ code: 'tetris()', id: '100', prompt: '"A game of Tetris"' }))
      const wrapper = await startApp()

      await openGame(wrapper, '100')

      expect(wrapper.text()).toContain('Missing required field: title')
      expect(wrapper.text()).not.toContain('Loading game...')
      expect(wrapper.findComponent(GameContainer).exists()).toBe(false)
      // It is not open, so the box makes a new game, and reading it again
      // would fail again
      expect(useAppStore().loadedGame).toBeNull()
      expect(button(wrapper, 'Retry')).toBeUndefined()
    })
  })

  describe('a game that cannot be generated', () => {
    beforeEach(() => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('shows why, and Retry asks the provider for the same game again', async () => {
      providers.anthropic.generateGame.mockImplementationOnce(async function* () {
        throw new Error('Claude CLI error: Not logged in · Please run /login')
      })
      const wrapper = await startApp()

      await generate()

      expect(wrapper.text()).toContain('Claude CLI error: Not logged in · Please run /login')
      expect(wrapper.findComponent(GameContainer).exists()).toBe(false)
      expect(useAppStore().gameList).toEqual([])

      await button(wrapper, 'Retry').trigger('click')
      await flushPromises()

      expect(providers.anthropic.generateGame).toHaveBeenCalledTimes(2)
      expect(providers.anthropic.generateGame.mock.calls[1][0]).toBe('A game of pong')
      expect(wrapper.findComponent(GameContainer).props('game').title).toBe('Pong')
    })

    it('says so when the provider gives no game', async () => {
      providers.anthropic.generateGame.mockImplementationOnce(async function* () {})
      const wrapper = await startApp()

      await generate()

      expect(wrapper.text()).toContain('No response from AI provider')
      expect(wrapper.findComponent(GameContainer).exists()).toBe(false)
    })
  })

  describe('a new game that fails as it starts', () => {
    // The game as the model writes it, calling a function it has not
    // defined, and as it writes it again, fixed
    const broken = { title: 'Pong', controls: 'Arrow keys', code: 'drawBall()' }
    const fixed = { title: 'Pong', controls: 'Arrow keys', code: 'draw()' }
    // What the game page reports as the game starts
    const startError = { message: "Can't find variable: drawBall", stack: 'global code@game.js:3:5' }

    beforeEach(() => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      saveGame.mockClear()
      deleteGameFromFS.mockClear()
    })

    it('goes back once, with its code and the error, to the same provider and model, and the fixed game is shown and saved in its place', async () => {
      answerWith(providers.anthropic, broken)
      const finishFixing = answerLater(providers.anthropic, fixed)
      const wrapper = await startAppWithGames()
      usePersistedStore().selectedModels.anthropic = 'opus'
      await generate()
      const brokenId = useAppStore().loadedGame
      expect(gameOnScreen(wrapper)).toContain('drawBall()')

      // The game throws as it starts, and the app says what it does about it
      await sendFromGame(wrapper, { type: 'error', data: startError })
      expect(wrapper.find('iframe').exists()).toBe(false)
      expect(wrapper.text()).toContain('Fixing an error in the game...')

      finishFixing()
      await flushPromises()

      // One more call, with the same model and system message, and a prompt
      // that holds the game's code and the error
      const calls = providers.anthropic.generateGame.mock.calls
      expect(calls).toHaveLength(2)
      const [fixPrompt, fixOptions] = calls[1]
      expect(fixPrompt).toContain('drawBall()')
      expect(fixPrompt).toContain(`${startError.message}\n${startError.stack}`)
      expect(fixOptions).toEqual(calls[0][1])
      expect(fixOptions.model).toBe('opus')

      // The fixed game runs in its place. It is saved with the user's
      // prompt, and the broken game is deleted.
      expect(wrapper.text()).not.toContain('Fixing an error')
      expect(gameOnScreen(wrapper)).toContain('draw()')
      expect(gameOnScreen(wrapper)).not.toContain('drawBall()')
      const fixedId = useAppStore().loadedGame
      expect(fixedId).not.toBe(brokenId)
      expect(saveGame).toHaveBeenLastCalledWith({
        id: fixedId,
        prompt: JSON.stringify('A game of pong'),
        content: JSON.stringify(fixed),
      })
      expect(deleteGameFromFS).toHaveBeenCalledWith(brokenId)
      expect(useAppStore().gameList).toEqual([expect.objectContaining({ id: fixedId, title: 'Pong' })])
    })

    it('names the line and column of a syntax error in the prompt for the fix', async () => {
      answerWith(providers.anthropic, { title: 'Pong', code: 'var speed = 5;\nvar x = speed +;' })
      answerWith(providers.anthropic, fixed)
      const wrapper = await startAppWithGames()
      await generate()

      // The game page reports the syntax error, as from Chromium, with its
      // place in the code
      const message = "Unexpected token ';'"
      await sendFromGame(wrapper, {
        type: 'error',
        data: { message, stack: `SyntaxError: ${message}`, line: 2, column: 16 },
      })

      const fixPrompt = providers.anthropic.generateGame.mock.calls[1][0]
      expect(fixPrompt).toContain(`with this error at line 2, column 16 of its code:\n\nSyntaxError: ${message}\n\n`)
    })

    it('says in the prompt for the fix that a syntax error is after the end of the code, and why', async () => {
      answerWith(providers.anthropic, { title: 'Pong', code: 'function draw() {\n  fill();\n' })
      answerWith(providers.anthropic, fixed)
      const wrapper = await startAppWithGames()
      await generate()

      // The game page reports the syntax error, as from WebKit, found after
      // the code, at the "catch" of the page's own code
      const message = "Unexpected keyword 'catch'"
      await sendFromGame(wrapper, { type: 'error', data: { message, afterCode: true } })

      const fixPrompt = providers.anthropic.generateGame.mock.calls[1][0]
      expect(fixPrompt).toContain(
        `with this error after the end of its code:\n\n${message}\n\nThe game page puts code of its own after the game's code, and the error is found there: the game's code ends before a brace, bracket or parenthesis is closed`
      )
    })

    it('shows the error of a fixed game that fails too, and asks for no second fix', async () => {
      answerWith(providers.anthropic, broken)
      answerWith(providers.anthropic, { title: 'Pong', code: 'drawPaddle()' })
      const wrapper = await startAppWithGames()
      await generate()
      await sendFromGame(wrapper, { type: 'error', data: startError })
      expect(gameOnScreen(wrapper)).toContain('drawPaddle()')

      // The fixed game throws as it starts, too
      await sendFromGame(wrapper, { type: 'error', data: { message: "Can't find variable: drawPaddle" } })

      expect(providers.anthropic.generateGame).toHaveBeenCalledTimes(2)
      expect(gameOnScreen(wrapper)).toContain('drawPaddle()')
      expect(notifications()).toContain("Game error: Can't find variable: drawPaddle")
    })

    it('shows why when the fix fails, and keeps the game as it was generated', async () => {
      // OpenAI, whose answer to the fix is cut off at its limit
      localStorage.setItem('selectedProvider', JSON.stringify('openai'))
      credentials.set('openai:apiKey', 'sk-test')
      const cutOff =
        'The answer from gpt-5.5 was cut off at the limit of 32768 tokens, reasoning included, before the game was complete. Retry, or describe a simpler game.'
      answerWith(providers.openai, broken)
      providers.openai.generateGame.mockImplementationOnce(async function* () {
        throw new Error(cutOff)
      })
      const wrapper = await startAppWithGames()
      usePersistedStore().selectedModels.openai = 'gpt-5.5'
      await generate()
      const brokenId = useAppStore().loadedGame

      await sendFromGame(wrapper, { type: 'error', data: startError })

      expect(providers.openai.generateGame).toHaveBeenCalledTimes(2)
      expect(providers.openai.generateGame.mock.calls[1][1].model).toBe('gpt-5.5')
      expect(wrapper.text()).toContain(cutOff)
      expect(button(wrapper, 'Retry')).toBeDefined()
      expect(saveGame).toHaveBeenCalledOnce()
      expect(deleteGameFromFS).not.toHaveBeenCalled()
      expect(useAppStore().gameList.map((game) => game.id)).toEqual([brokenId])
    })

    it('is not fixed when it fails after its first 5 seconds', async () => {
      vi.useFakeTimers()
      answerWith(providers.anthropic, broken)
      const wrapper = await startAppWithGames()
      await generate()

      await sendFromGame(wrapper, { type: 'ready', data: {} })
      await vi.advanceTimersByTimeAsync(5000)
      await sendFromGame(wrapper, { type: 'error', data: { message: 'An error after 5 s' } })

      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
      expect(gameOnScreen(wrapper)).toContain('drawBall()')
      expect(notifications()).toContain('Game error: An error after 5 s')
    })

    // A game with a start screen plays from the player's first input, which
    // its page reports
    it("is fixed when it fails in the first 5 seconds after the player's first input, however long the start screen was shown", async () => {
      vi.useFakeTimers()
      answerWith(providers.anthropic, broken)
      answerWith(providers.anthropic, fixed)
      const wrapper = await startAppWithGames()
      await generate()

      // The start screen is shown for 20 seconds. The player taps, and 3
      // seconds into play the game throws.
      await sendFromGame(wrapper, { type: 'ready', data: {} })
      await vi.advanceTimersByTimeAsync(20000)
      await sendFromGame(wrapper, { type: 'firstInput', data: {} })
      await vi.advanceTimersByTimeAsync(3000)
      const playError = { message: "Can't find variable: drawBall", stack: 'play@game.js:12:5' }
      await sendFromGame(wrapper, { type: 'error', data: playError })

      const calls = providers.anthropic.generateGame.mock.calls
      expect(calls).toHaveLength(2)
      expect(calls[1][0]).toContain(`${playError.message}\n${playError.stack}`)
      expect(gameOnScreen(wrapper)).toContain('draw()')
      expect(gameOnScreen(wrapper)).not.toContain('drawBall()')
    })

    it("is not fixed when it fails 6 seconds after the player's first input", async () => {
      vi.useFakeTimers()
      answerWith(providers.anthropic, broken)
      const wrapper = await startAppWithGames()
      await generate()

      await sendFromGame(wrapper, { type: 'ready', data: {} })
      await vi.advanceTimersByTimeAsync(20000)
      await sendFromGame(wrapper, { type: 'firstInput', data: {} })
      await vi.advanceTimersByTimeAsync(6000)
      await sendFromGame(wrapper, { type: 'error', data: { message: 'An error 6 s into play' } })

      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
      expect(gameOnScreen(wrapper)).toContain('drawBall()')
      expect(notifications()).toContain('Game error: An error 6 s into play')
    })

    it('is not fixed when it was opened from the list', async () => {
      addSavedGame('100', 'Tetris')
      answerWith(providers.anthropic, broken)
      const wrapper = await startAppWithGames()
      await generate()
      const pong = useAppStore().loadedGame

      // The new game, opened again from the list, fails as it starts
      await openGame(wrapper, pong)
      await sendFromGame(wrapper, { type: 'error', data: startError })
      expect(gameOnScreen(wrapper)).toContain('drawBall()')
      // So does a saved game
      await openGame(wrapper, '100')
      await sendFromGame(wrapper, { type: 'error', data: { message: "Can't find variable: tetris" } })

      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
      expect(gameOnScreen(wrapper)).toContain('tetris()')
      expect(notifications()).toContain("Game error: Can't find variable: tetris")
    })

    it('is not fixed when the user has switched provider since it was generated', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      answerWith(providers.anthropic, broken)
      const wrapper = await startAppWithGames()
      await generate()

      await switchProvider(wrapper, 'openai')
      await sendFromGame(wrapper, { type: 'error', data: startError })

      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
      expect(providers.openai.generateGame).not.toHaveBeenCalled()
      expect(gameOnScreen(wrapper)).toContain('drawBall()')
    })
  })

  describe('changing the open game', () => {
    // A game of Pong as the model writes it, the change blocks of a request
    // to make its ball faster, and the game they make
    const pong = { title: 'Pong', description: 'Two paddles and a ball', rules: 'First to 5 wins', code: 'var speed = 5;\nball(speed);' }
    const faster = { changes: [{ find: 'var speed = 5;', replace: 'var speed = 8;' }], rules: 'First to 7 wins' }
    const fasterPong = { ...pong, rules: 'First to 7 wins', code: 'var speed = 8;\nball(speed);' }
    // What the game page reports when a game fails as it starts
    const startError = { message: "Can't find variable: drawBall", stack: 'global code@game.js:2:1' }

    beforeEach(() => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    // Starts the app with its game container, and generates a game of Pong,
    // which is then the open game. Returns the app and the game's id.
    async function startWithPong() {
      answerWith(providers.anthropic, pong)
      const wrapper = await startAppWithGames()
      await generate()
      return { wrapper, id: useAppStore().loadedGame }
    }

    // What the game file of Pong holds, besides the game
    function pongFile(id, versions) {
      return { id, prompt: JSON.stringify('A game of pong'), versions }
    }

    // The requests sent to a provider, as [prompt, options]
    function requests(provider) {
      return provider.generateGame.mock.calls
    }

    // The provider fails its next request with the error when the test
    // calls the function returned
    function failLater(provider, error) {
      let finish
      const finished = new Promise((resolve) => { finish = resolve })
      provider.generateGame.mockImplementationOnce(async function* () {
        await finished
        throw error
      })
      return () => finish()
    }

    // Keeps the next call of a game storage function running until the test
    // ends it, and then runs it, or the stand-in given
    function holdStorage(storageFunction, run = storageFunction.getMockImplementation()) {
      let finish
      storageFunction.mockImplementationOnce(
        (...args) => new Promise((resolve, reject) => { finish = () => run(...args).then(resolve, reject) })
      )
      return () => finish()
    }

    async function pressUndo(wrapper) {
      await button(wrapper, 'Undo change').trigger('click')
      await flushPromises()
    }

    it('sends the game as saved, the requests it was made from and the new request to the provider and model selected now, and shows the changed game as its new version', async () => {
      const { wrapper, id } = await startWithPong()
      usePersistedStore().selectedModels.anthropic = 'opus'
      answerWith(providers.anthropic, faster)

      await send('Make the ball faster')

      // A new call, with the system message and the model selected now, and
      // the answer read as change blocks
      const [first, change] = requests(providers.anthropic)
      expect(requests(providers.anthropic)).toHaveLength(2)
      expect(change[0]).toBe(getChangePrompt(pong, 'Make the ball faster', ['A game of pong']))
      expect(change[1]).toEqual({ ...first[1], model: 'opus', parse: parseChangeAnswer })

      // The same game, changed: on screen, in the list, and in its file, with
      // the version before kept
      expect(gameOnScreen(wrapper)).toContain('var speed = 8;\nball(speed);')
      expect(useAppStore().loadedGame).toBe(id)
      expect(useAppStore().gameList).toEqual([expect.objectContaining({ id, title: 'Pong', rules: 'First to 7 wins' })])
      expect(gameFiles()).toEqual({
        [`${id}-pong.json`]: { ...fasterPong, ...pongFile(id, [{ game: pong, request: 'Make the ball faster' }]) },
      })
      expect(button(wrapper, 'Undo change')).toBeDefined()
    })

    it('shows "Changing the game..." and the seconds, with the spinner, and takes no other request or undo until it ends', async () => {
      vi.useFakeTimers()
      const { wrapper } = await startWithPong()
      answerWith(providers.anthropic, faster)
      await send('Make the ball faster')

      const finishChanging = answerLater(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'ball(speed * 2);' }] })
      await send('Make it twice as fast')
      await vi.advanceTimersByTimeAsync(3000)

      expect(wrapper.text()).toContain('Changing the game... (3s)')
      expect(wrapper.findComponent(QSpinnerGears).exists()).toBe(true)
      expect(wrapper.find('iframe').exists()).toBe(false)
      expect(useAppStore().generating).toBe(true)
      expect(button(wrapper, 'Undo change').props('disable')).toBe(true)
      expect(button(wrapper, 'New game')).toBeDefined()

      finishChanging()
      await flushPromises()

      expect(gameOnScreen(wrapper)).toContain('ball(speed * 2);')
      expect(useAppStore().generating).toBe(false)
      expect(button(wrapper, 'Undo change').props('disable')).toBe(false)
    })

    it.each([
      ['is not JSON', 'Here are the changes: the ball is faster'],
      ['has a block whose text is not in the code', { changes: [{ find: 'var speed = 6;', replace: 'var speed = 8;' }] }],
      ['has a block whose text is in the code twice', { changes: [{ find: 'speed', replace: 'pace' }] }],
      ['has blocks that overlap', { changes: [{ find: 'var speed = 5;', replace: 'var speed = 8;' }, { find: '5;\nball', replace: '5;\nballs' }] }],
    ])('asks once for the whole game, read as a new game is, when the answer %s', async (why, answer) => {
      const { wrapper, id } = await startWithPong()
      const wholeGame = { ...pong, code: 'var speed = 9;\nball(speed);' }
      answerWith(providers.anthropic, answer)
      answerWith(providers.anthropic, wholeGame)

      await send('Make the ball faster')

      const [first, , whole] = requests(providers.anthropic)
      expect(requests(providers.anthropic)).toHaveLength(3)
      expect(whole[0]).toBe(getChangePrompt(pong, 'Make the ball faster', ['A game of pong'], { wholeGame: true }))
      expect(whole[1]).toEqual(first[1])
      expect(gameOnScreen(wrapper)).toContain('var speed = 9;')
      expect(gameFiles()).toEqual({
        [`${id}-pong.json`]: { ...wholeGame, ...pongFile(id, [{ game: pong, request: 'Make the ball faster' }]) },
      })
    })

    it('shows why when the whole game cannot be read either, and the game stays as it was', async () => {
      const { wrapper, id } = await startWithPong()
      const files = gameFiles()
      answerWith(providers.anthropic, { changes: [{ find: 'var speed = 6;', replace: 'var speed = 8;' }] })
      answerWith(providers.anthropic, { title: 'Pong' })

      await send('Make the ball faster')

      expect(requests(providers.anthropic)).toHaveLength(3)
      expect(wrapper.text()).toContain('Failed to parse game response: Missing required field: code')
      expect(gameFiles()).toEqual(files)
      expect(useAppStore().loadedGame).toBe(id)
      expect(useAppStore().gameList).toEqual([expect.objectContaining({ id, rules: 'First to 5 wins' })])
      expect(button(wrapper, 'Undo change')).toBeUndefined()
    })

    it('shows why when the request fails, asks for no whole game, and Retry sends the change again', async () => {
      const { wrapper, id } = await startWithPong()
      failLater(providers.anthropic, new Error('Claude CLI error: Not logged in · Please run /login'))()

      await send('Make the ball faster')

      expect(requests(providers.anthropic)).toHaveLength(2)
      expect(wrapper.text()).toContain('Claude CLI error: Not logged in · Please run /login')

      answerWith(providers.anthropic, faster)
      await button(wrapper, 'Retry').trigger('click')
      await flushPromises()

      expect(requests(providers.anthropic)).toHaveLength(3)
      expect(requests(providers.anthropic)[2][0]).toBe(getChangePrompt(pong, 'Make the ball faster', ['A game of pong']))
      expect(gameOnScreen(wrapper)).toContain('var speed = 8;')
      expect(useAppStore().loadedGame).toBe(id)
    })

    it('shows why a change cannot be saved, as the file system says it, and the game stays as it was', async () => {
      const { wrapper, id } = await startWithPong()
      const files = gameFiles()
      // Tauri's file system rejects with a string
      addGameVersion.mockRejectedValueOnce('failed to write the file: No space left on device')
      answerWith(providers.anthropic, faster)

      await send('Make the ball faster')

      expect(wrapper.text()).toContain('failed to write the file: No space left on device')
      expect(gameFiles()).toEqual(files)
      expect(useAppStore().loadedGame).toBe(id)
      expect(button(wrapper, 'Retry')).toBeDefined()
    })

    it('shows why the open game cannot be changed when its file no longer holds a game', async () => {
      const { wrapper, id } = await startWithPong()
      // The file was changed outside the app, and has lost its code
      files.set(`${gamesFolder}/${id}-pong.json`, JSON.stringify({ title: 'Pong', id, prompt: JSON.stringify('A game of pong') }))

      await send('Make the ball faster')

      expect(wrapper.text()).toContain('Missing required field: code')
      expect(requests(providers.anthropic)).toHaveLength(1)
    })

    it('says so when no provider is connected, and Retry sends the change once one is', async () => {
      const { wrapper, id } = await startWithPong()
      await wrapper.findComponent(Settings).vm.$emit('providerDisconnected', 'anthropic')
      await flushPromises()

      await send('Make the ball faster')

      expect(wrapper.text()).toContain('No AI provider connected. Open Settings to connect.')
      expect(requests(providers.anthropic)).toHaveLength(1)

      await wrapper.findComponent(Settings).props('connectClaude')()
      answerWith(providers.anthropic, faster)
      await button(wrapper, 'Retry').trigger('click')
      await flushPromises()

      expect(requests(providers.anthropic)[1][0]).toBe(getChangePrompt(pong, 'Make the ball faster', ['A game of pong']))
      expect(gameFiles()[`${id}-pong.json`].code).toBe(fasterPong.code)
    })

    it('sends the game as changed, with every request it was made from, and Undo change goes back one version at a time, deleting saved progress', async () => {
      const { wrapper, id } = await startWithPong()
      answerWith(providers.anthropic, faster)
      await send('Make the ball faster')
      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'ball(speed);\nball(speed);' }], title: 'Double Pong' })
      await send('Add a second ball')

      expect(requests(providers.anthropic)[2][0]).toBe(
        getChangePrompt(fasterPong, 'Add a second ball', ['A game of pong', 'Make the ball faster'])
      )
      expect(wrapper.find('.q-toolbar__title').text()).toBe('Double Pong')
      expect(Object.keys(gameFiles())).toEqual([`${id}-double-pong.json`])
      expect(useAppStore().gameList).toEqual([expect.objectContaining({ id, title: 'Double Pong' })])

      // Progress saved in the second version
      files.set(`${gamesFolder}/${id}-double-pong.state.json`, '{"score":3}')
      await pressUndo(wrapper)

      expect(gameOnScreen(wrapper)).toContain('var speed = 8;\nball(speed);')
      expect(gameOnScreen(wrapper)).not.toContain('ball(speed);\nball(speed);')
      expect(wrapper.find('.q-toolbar__title').text()).toBe('Pong')
      expect(Object.keys(gameFiles())).toEqual([`${id}-pong.json`])
      expect(useAppStore().gameList).toEqual([expect.objectContaining({ id, title: 'Pong', rules: 'First to 7 wins' })])

      await pressUndo(wrapper)

      expect(gameOnScreen(wrapper)).toContain('var speed = 5;')
      expect(gameFiles()).toEqual({ [`${id}-pong.json`]: { ...pong, ...pongFile(id, []) } })
      expect(button(wrapper, 'Undo change')).toBeUndefined()
      expect(useAppStore().loadedGame).toBe(id)
      expect(useAppStore().gameList).toHaveLength(1)
    })

    it('offers Undo change for a saved game opened from the list that has an earlier version', async () => {
      const { wrapper, id } = await startWithPong()
      answerWith(providers.anthropic, faster)
      await send('Make the ball faster')
      await pressNewGame(wrapper)
      expect(button(wrapper, 'Undo change')).toBeUndefined()

      await openGame(wrapper, id)
      expect(button(wrapper, 'Undo change')).toBeDefined()
      await pressUndo(wrapper)

      expect(gameOnScreen(wrapper)).toContain('var speed = 5;')
    })

    it('shows why an undo fails, with no Retry', async () => {
      const { wrapper } = await startWithPong()
      answerWith(providers.anthropic, faster)
      await send('Make the ball faster')
      undoGameVersion.mockRejectedValueOnce('Permission denied')

      await pressUndo(wrapper)

      expect(wrapper.text()).toContain('Permission denied')
      expect(button(wrapper, 'Retry')).toBeUndefined()
    })

    it('sends a changed game that fails as it starts back once to the provider and model that made the change, and the fixed game replaces that version', async () => {
      const { wrapper, id } = await startWithPong()
      usePersistedStore().selectedModels.anthropic = 'opus'
      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'drawBall(speed);' }] })
      await send('Make the ball round')
      const broken = { ...pong, code: 'var speed = 5;\ndrawBall(speed);' }
      expect(gameOnScreen(wrapper)).toContain('drawBall(speed);')

      const fixed = { ...pong, code: 'var speed = 5;\nroundBall(speed);' }
      answerWith(providers.anthropic, fixed)
      await sendFromGame(wrapper, { type: 'error', data: startError })

      const [first, , fix] = requests(providers.anthropic)
      expect(requests(providers.anthropic)).toHaveLength(3)
      expect(fix[0]).toBe(getFixPrompt(broken, startError))
      expect(fix[1]).toEqual({ ...first[1], model: 'opus' })
      // The same game, with the fixed game in place of the version that failed
      expect(gameOnScreen(wrapper)).toContain('roundBall(speed);')
      expect(useAppStore().loadedGame).toBe(id)
      expect(useAppStore().gameList).toEqual([expect.objectContaining({ id, title: 'Pong' })])
      expect(gameFiles()).toEqual({
        [`${id}-pong.json`]: { ...fixed, ...pongFile(id, [{ game: pong, request: 'Make the ball round' }]) },
      })

      // The fixed game gets no second fix
      await sendFromGame(wrapper, { type: 'error', data: { message: "Can't find variable: roundBall" } })
      expect(requests(providers.anthropic)).toHaveLength(3)
    })

    it('shows why when the fix of a changed game fails, and Retry makes the change again from the version it was made to', async () => {
      const { wrapper, id } = await startWithPong()
      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'drawBall(speed);' }] })
      await send('Make the ball round')
      failLater(providers.anthropic, new Error('Claude CLI error: rate limited'))()
      await sendFromGame(wrapper, { type: 'error', data: startError })

      expect(wrapper.text()).toContain('Claude CLI error: rate limited')
      // The version that failed stays, and Undo change goes back from it
      expect(gameFiles()[`${id}-pong.json`].code).toBe('var speed = 5;\ndrawBall(speed);')
      expect(button(wrapper, 'Undo change')).toBeDefined()

      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'roundBall(speed);' }] })
      await button(wrapper, 'Retry').trigger('click')
      await flushPromises()

      expect(requests(providers.anthropic)[3][0]).toBe(getChangePrompt(pong, 'Make the ball round', ['A game of pong']))
      expect(gameOnScreen(wrapper)).toContain('roundBall(speed);')
      expect(gameFiles()).toEqual({
        [`${id}-pong.json`]: {
          ...pong,
          code: 'var speed = 5;\nroundBall(speed);',
          ...pongFile(id, [{ game: pong, request: 'Make the ball round' }]),
        },
      })
    })

    it('Retry after a fix that failed sends the change again, with no second undo, when the change fails too', async () => {
      const { wrapper, id } = await startWithPong()
      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'drawBall(speed);' }] })
      await send('Make the ball round')
      failLater(providers.anthropic, new Error('Claude CLI error: rate limited'))()
      await sendFromGame(wrapper, { type: 'error', data: startError })

      failLater(providers.anthropic, new Error('Claude CLI error: rate limited again'))()
      await button(wrapper, 'Retry').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Claude CLI error: rate limited again')
      expect(gameFiles()[`${id}-pong.json`]).toEqual({ ...pong, ...pongFile(id, []) })
      expect(button(wrapper, 'Undo change')).toBeUndefined()

      answerWith(providers.anthropic, faster)
      await button(wrapper, 'Retry').trigger('click')
      await flushPromises()

      expect(gameFiles()[`${id}-pong.json`]).toEqual({ ...fasterPong, ...pongFile(id, [{ game: pong, request: 'Make the ball round' }]) })
    })

    it('New game closes the open game, and the box then makes a new game from the description', async () => {
      const { wrapper, id } = await startWithPong()

      await pressNewGame(wrapper)

      expect(useAppStore().loadedGame).toBeNull()
      expect(wrapper.text()).toContain('Welcome to Gaimer')
      expect(wrapper.find('iframe').exists()).toBe(false)
      expect(button(wrapper, 'New game')).toBeUndefined()

      answerWith(providers.anthropic, { title: 'Snake', code: 'snake()' })
      await send('A game of snake')

      const [, request] = requests(providers.anthropic)
      expect(request[0]).toBe('A game of snake')
      expect(request[1]).not.toHaveProperty('parse')
      expect(gameOnScreen(wrapper)).toContain('snake()')
      expect(useAppStore().gameList.map((game) => game.title)).toEqual(['Snake', 'Pong'])
      expect(useAppStore().loadedGame).not.toBe(id)
    })

    it('does not let an answer land on another game the user opened meanwhile, and saves nothing', async () => {
      addSavedGame('100', 'Tetris')
      const { wrapper, id } = await startWithPong()
      const files = gameFiles()
      const finishChanging = answerLater(providers.anthropic, faster)
      await send('Make the ball faster')

      await openGame(wrapper, '100')
      finishChanging()
      await flushPromises()

      expect(gameOnScreen(wrapper)).toContain('tetris()')
      expect(useAppStore().loadedGame).toBe('100')
      expect(gameFiles()).toEqual(files)
      expect(useAppStore().generating).toBe(false)
      expect(useAppStore().gameList.find((game) => game.id === id).rules).toBe('First to 5 wins')
    })

    it('drops the answer when the user starts a new game while the change runs', async () => {
      const { wrapper } = await startWithPong()
      const files = gameFiles()
      const finishChanging = answerLater(providers.anthropic, faster)
      await send('Make the ball faster')

      await pressNewGame(wrapper)
      finishChanging()
      await flushPromises()

      expect(wrapper.text()).toContain('Welcome to Gaimer')
      expect(useAppStore().loadedGame).toBeNull()
      expect(gameFiles()).toEqual(files)
    })

    it('drops the answer when the user deletes the game while the change runs, so the game does not come back', async () => {
      const { wrapper, id } = await startWithPong()
      const finishChanging = answerLater(providers.anthropic, faster)
      await send('Make the ball faster')

      // What GameList does when the user deletes the game
      await deleteGameFromFS(id)
      await deleteGame(wrapper, id)
      expect(wrapper.text()).toContain('Welcome to Gaimer')
      finishChanging()
      await flushPromises()

      expect(gameFiles()).toEqual({})
      expect(wrapper.text()).toContain('Welcome to Gaimer')
      expect(useAppStore().loadedGame).toBeNull()
    })

    it('asks for no whole game when the user has left the game by the time the change blocks cannot be made', async () => {
      addSavedGame('100', 'Tetris')
      const { wrapper } = await startWithPong()
      const finishChanging = answerLater(providers.anthropic, { changes: [{ find: 'var speed = 6;', replace: 'var speed = 8;' }] })
      await send('Make the ball faster')

      await openGame(wrapper, '100')
      finishChanging()
      await flushPromises()

      expect(requests(providers.anthropic)).toHaveLength(2)
      expect(gameOnScreen(wrapper)).toContain('tetris()')
    })

    it('shows no error for a change that fails after the user has left the game', async () => {
      addSavedGame('100', 'Tetris')
      const { wrapper } = await startWithPong()
      const failChanging = failLater(providers.anthropic, new Error('Claude CLI error: rate limited'))
      await send('Make the ball faster')

      await openGame(wrapper, '100')
      failChanging()
      await flushPromises()

      expect(wrapper.text()).not.toContain('rate limited')
      expect(gameOnScreen(wrapper)).toContain('tetris()')
    })

    it('sends no request when the user has left the game by the time it has been read', async () => {
      addSavedGame('100', 'Tetris')
      const { wrapper, id } = await startWithPong()
      const finishReading = holdGameRead()
      await send('Make the ball faster')

      await openGame(wrapper, '100')
      finishReading()
      await flushPromises()

      expect(requests(providers.anthropic)).toHaveLength(1)
      expect(gameOnScreen(wrapper)).toContain('tetris()')
      expect(Object.keys(gameFiles())).toEqual(['100-tetris.json', `${id}-pong.json`])
    })

    it('saves but does not show a version whose saving ends after the user has left the game', async () => {
      addSavedGame('100', 'Tetris')
      const { wrapper, id } = await startWithPong()
      const finishSaving = holdStorage(addGameVersion)
      answerWith(providers.anthropic, faster)
      await send('Make the ball faster')

      await openGame(wrapper, '100')
      finishSaving()
      await flushPromises()

      expect(gameOnScreen(wrapper)).toContain('tetris()')
      expect(gameFiles()[`${id}-pong.json`].code).toBe(fasterPong.code)
    })

    it('goes on with the provider it was sent to when the user switches provider meanwhile, and the new version gets no fix', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      const { wrapper, id } = await startWithPong()
      const finishChanging = answerLater(providers.anthropic, faster)
      await send('Make the ball faster')

      await switchProvider(wrapper, 'openai')
      finishChanging()
      await flushPromises()

      expect(gameOnScreen(wrapper)).toContain('var speed = 8;')
      expect(useAppStore().loadedGame).toBe(id)
      expect(gameFiles()[`${id}-pong.json`].code).toBe(fasterPong.code)

      // It fails as it starts, but the provider that made it is no longer the active one
      await sendFromGame(wrapper, { type: 'error', data: startError })
      expect(requests(providers.anthropic)).toHaveLength(2)
      expect(providers.openai.generateGame).not.toHaveBeenCalled()
    })

    it('drops the fix of a changed game when the user has left the game by the time it comes', async () => {
      const { wrapper, id } = await startWithPong()
      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'drawBall(speed);' }] })
      await send('Make the ball round')
      const finishFixing = answerLater(providers.anthropic, { ...pong, code: 'var speed = 5;\nroundBall(speed);' })
      await sendFromGame(wrapper, { type: 'error', data: startError })
      expect(wrapper.text()).toContain('Fixing an error in the game...')

      await pressNewGame(wrapper)
      finishFixing()
      await flushPromises()

      expect(wrapper.text()).toContain('Welcome to Gaimer')
      expect(gameFiles()[`${id}-pong.json`].code).toBe('var speed = 5;\ndrawBall(speed);')
    })

    it('shows no error for a fix of a changed game that fails after the user has left the game', async () => {
      const { wrapper } = await startWithPong()
      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'drawBall(speed);' }] })
      await send('Make the ball round')
      const failFixing = failLater(providers.anthropic, new Error('Claude CLI error: rate limited'))
      await sendFromGame(wrapper, { type: 'error', data: startError })

      await pressNewGame(wrapper)
      failFixing()
      await flushPromises()

      expect(wrapper.text()).not.toContain('rate limited')
      expect(wrapper.text()).toContain('Welcome to Gaimer')
    })

    it('saves but does not show a fixed version whose saving ends after the user has left the game', async () => {
      addSavedGame('100', 'Tetris')
      const { wrapper, id } = await startWithPong()
      answerWith(providers.anthropic, { changes: [{ find: 'ball(speed);', replace: 'drawBall(speed);' }] })
      await send('Make the ball round')
      const finishSaving = holdStorage(replaceGameVersion)
      answerWith(providers.anthropic, { ...pong, code: 'var speed = 5;\nroundBall(speed);' })
      await sendFromGame(wrapper, { type: 'error', data: startError })

      await openGame(wrapper, '100')
      finishSaving()
      await flushPromises()

      expect(gameOnScreen(wrapper)).toContain('tetris()')
      expect(gameFiles()[`${id}-pong.json`].code).toBe('var speed = 5;\nroundBall(speed);')
    })

    it('does not show an undone version, or why an undo failed, after the user has left the game', async () => {
      addSavedGame('100', 'Tetris')
      const { wrapper, id } = await startWithPong()
      answerWith(providers.anthropic, faster)
      await send('Make the ball faster')

      const finishUndo = holdStorage(undoGameVersion)
      await button(wrapper, 'Undo change').trigger('click')
      await openGame(wrapper, '100')
      finishUndo()
      await flushPromises()
      expect(gameOnScreen(wrapper)).toContain('tetris()')
      expect(gameFiles()[`${id}-pong.json`].code).toBe(pong.code)

      await openGame(wrapper, id)
      answerWith(providers.anthropic, faster)
      await send('Make the ball faster')
      const failUndo = holdStorage(undoGameVersion, async () => { throw new Error('Permission denied') })
      await button(wrapper, 'Undo change').trigger('click')
      await openGame(wrapper, '100')
      failUndo()
      await flushPromises()
      expect(wrapper.text()).not.toContain('Permission denied')
      expect(gameOnScreen(wrapper)).toContain('tetris()')
    })

    it('lists the requests of a saved game whose description is not kept as JSON, or not kept', async () => {
      const game = { title: 'Tetris', code: 'tetris();' }
      files.set(`${gamesFolder}/100-tetris.json`, JSON.stringify({ ...game, id: '100', prompt: 'A game of Tetris' }))
      files.set(`${gamesFolder}/200-tetris.json`, JSON.stringify({ ...game, id: '200' }))
      const wrapper = await startAppWithGames()
      const change = { changes: [{ find: 'tetris();', replace: 'tetris(2);' }] }

      await openGame(wrapper, '100')
      answerWith(providers.anthropic, change)
      await send('Make it faster')
      await openGame(wrapper, '200')
      answerWith(providers.anthropic, change)
      await send('Make it faster')

      expect(requests(providers.anthropic).map(([prompt]) => prompt)).toEqual([
        getChangePrompt(game, 'Make it faster', ['A game of Tetris']),
        getChangePrompt(game, 'Make it faster', []),
      ])
    })
  })
})
