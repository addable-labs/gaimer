import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtn, QBtnToggle } from 'quasar'
import App from '../../src/App.vue'
import Settings from '../../src/components/Settings.vue'
import ConnectClaude from '../../src/components/ConnectClaude.vue'
import GameList from '../../src/components/GameList.vue'
import GameContainer from '../../src/components/GameContainer.vue'
import { listGames, loadGame as loadGameFromFS, saveGame, deleteGame as deleteGameFromFS } from '../../src/helpers/game-storage.js'
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

// The temp files the Claude provider writes for a game generation
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn(async () => '/tmp'),
  join: vi.fn(async (...parts) => parts.join('/')),
}))

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

// The saved games in the game folder, by id, as the game storage returns them
const savedGames = vi.hoisted(() => new Map())
vi.mock('../../src/helpers/game-storage.js', () => ({
  initStorage: vi.fn(async () => {}),
  listGames: vi.fn(async () => []),
  saveGame: vi.fn(async (game) => { savedGames.set(game.id, game) }),
  loadGame: vi.fn(async (id) => {
    if (!savedGames.has(id)) throw new Error(`Game not found: ${id}`)
    return savedGames.get(id)
  }),
  deleteGame: vi.fn(async (id) => { savedGames.delete(id) }),
}))

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
    generateGame: vi.fn(async function* () {
      if (!connected) throw new Error('Provider not connected')
      yield { type: 'complete', data: { title: 'Pong', code: 'draw()' } }
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
  savedGames.set(id, { id, prompt: JSON.stringify(`A game of ${title}`), content: JSON.stringify(game) })
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

// The provider answers its next request with the game when the test calls
// the function returned. By the clock, answering takes the model a minute.
function answerLater(provider, game) {
  let finish
  const finished = new Promise((resolve) => { finish = resolve })
  provider.generateGame.mockImplementationOnce(async function* () {
    await finished
    vi.setSystemTime(Date.now() + 60_000)
    yield { type: 'complete', data: game }
  })
  return () => finish()
}

// The provider answers its next request with the game
function answerWith(provider, game) {
  answerLater(provider, game)()
}

enableAutoUnmount(afterEach)

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    credentials.clear()
    savedGames.clear()
    providers.openai = fakeProvider('openai')
    providers.anthropic = fakeProvider('anthropic')
    shell.ran = []
    shell.output = claudeCli
    shell.exits = () => true
    shell.running = []
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
      await generate()
      await deleteGame(wrapper, openGame)
      expect(wrapper.text()).toContain('Generating game...')

      finishGenerating()
      await flushPromises()
      expect(wrapper.findComponent(GameContainer).exists()).toBe(true)
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
      savedGames.delete('100')
      await deleteGame(wrapper, '100')
      finishReading()
      await flushPromises()

      expect(wrapper.text()).not.toContain('Game not found')
      expect(wrapper.text()).toContain('Welcome to Gaimer')
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
})
