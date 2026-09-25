import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtn, QBtnToggle } from 'quasar'
import App from '../../src/App.vue'
import Settings from '../../src/components/Settings.vue'
import ConnectClaude from '../../src/components/ConnectClaude.vue'
import GameList from '../../src/components/GameList.vue'
import GameContainer from '../../src/components/GameContainer.vue'
import { listGames, loadGame as loadGameFromFS } from '../../src/helpers/game-storage.js'
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
  saveGame: vi.fn(async () => {}),
  loadGame: vi.fn(async (id) => {
    if (!savedGames.has(id)) throw new Error(`Game not found: ${id}`)
    return savedGames.get(id)
  }),
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
  if (line === 'claude --version') return '2.1.281 (Claude Code)\n'
  if (line === 'claude auth status') return JSON.stringify({ loggedIn: true }, null, 2)
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

// Starts the app. Settings is stubbed unless other stubs are given: with
// {}, Settings and its Claude panel are real.
async function startApp(stubs = { Settings: true }) {
  const wrapper = mount(App, {
    global: {
      plugins: [Quasar],
      stubs: { GameList: true, GameContainer: true, UserInput: true, ...stubs },
    },
  })
  await flushPromises()
  return wrapper
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
      shell.exits = ({ args }) => args[2] !== 'claude --version'
      await pickProvider(wrapper, 'anthropic')
      await pickProvider(wrapper, 'openai')
      endRun('claude --version')
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
      expect(timesRun('claude --version')).toBe(1)
      expect(timesRun('claude auth status')).toBe(1)
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
})
