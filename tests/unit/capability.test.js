import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import ConnectClaude from '../../src/components/ConnectClaude.vue'
import { createAnthropicProvider } from '../../src/providers/anthropic-provider.js'
import { grants, openerOpens, pluginCommands, shellRuns } from '../capability.js'
import { shell } from '../plugin-shell.js'

vi.mock('@tauri-apps/plugin-shell', () => import('../plugin-shell.js'))

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}))

// An app's temp directory on macOS
vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn(async () => '/var/folders/9x/k2m0qv1s3fj6y9z_w8r4c5d00000gn/T'),
  join: vi.fn(async (...parts) => parts.join('/')),
}))

const game = { title: 'Pong', description: 'Two paddles and a ball', code: 'draw()' }

// What the Claude CLI prints, given the arguments of the login shell that
// runs it
function claudeCli({ args }) {
  const line = args[2]
  if (line === 'claude --version') return '2.1.281 (Claude Code)\n'
  if (line === 'claude auth status') return JSON.stringify({ loggedIn: true }, null, 2)
  return JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(game) }) + '\n'
}

// A login shell running a command line
function zsh(line) {
  return { cmd: '/bin/zsh', args: ['-l', '-c', line] }
}

// What the shell plugin starts when a script asks shell-cmd to run a command
// line, or null when it refuses
function runs(line) {
  return shellRuns('spawn', 'shell-cmd', ['-l', '-c', line])
}

// The command line the provider runs to generate a game with the model
async function generation(model = 'claude-sonnet-4-6') {
  const provider = createAnthropicProvider()
  await provider.connect()
  await provider.generateGame('A game of pong', { model }).next()
  return shell.ran.at(-1).args[2]
}

enableAutoUnmount(afterEach)

describe('main window capability', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    shell.ran = []
    shell.output = claudeCli
  })

  it('grants only the shell and opener commands the app calls', () => {
    expect(pluginCommands.shell.filter((command) => grants('shell', command))).toEqual(['spawn'])
    expect(pluginCommands.opener.filter((command) => grants('opener', command))).toEqual(['open_url'])
  })

  describe('shell-cmd', () => {
    it('runs the Claude panel\'s checks of the CLI and its sign-in', async () => {
      mount(ConnectClaude, { global: { plugins: [Quasar] } })
      await flushPromises()

      expect(shell.ran).toEqual([zsh('claude --version'), zsh('claude auth status')])
    })

    it('runs the provider\'s sign-in check and a game generation with each Claude model', async () => {
      const provider = createAnthropicProvider()
      await provider.connect()
      const models = await provider.listModels()
      for (const model of models) {
        await provider.generateGame('A game of pong', { model }).next()
      }

      expect(shell.ran).toEqual([
        zsh('claude auth status'),
        ...models.map((model) => zsh(expect.stringContaining(`claude -p --model ${model} `))),
      ])
    })

    it('refuses any other command line', () => {
      expect(runs('id')).toBeNull()
      expect(runs('claude auth logout')).toBeNull()
      expect(runs('claude --version --debug')).toBeNull()
    })

    it('refuses a second command before or after one it allows', async () => {
      for (const line of ['claude --version', 'claude auth status', await generation()]) {
        for (const separator of [';', ' &&', ' ||', ' |', '\n']) {
          expect(runs(`${line}${separator} id`), `${line}${separator} id`).toBeNull()
          expect(runs(`id${separator} ${line}`), `id${separator} ${line}`).toBeNull()
        }
      }
    })

    it('refuses a model name that is not a plain model id', async () => {
      const models = ['claude-sonnet-4-6 --verbose', "claude'sonnet", 'claude"sonnet', 'sonnet;id', '$(id)', '--verbose']
      for (const model of models) {
        await expect(generation(model), model).rejects.toThrow('program not allowed')
      }
    })

    it('refuses --bare or --mcp-config in place of the flags that keep the user\'s Claude setup out', async () => {
      const line = await generation()

      expect(runs(line.replace('--safe-mode', '--bare'))).toBeNull()
      expect(runs(line.replace('--strict-mcp-config', "--mcp-config '/tmp/servers.json'"))).toBeNull()
      expect(runs(line.replace(' --safe-mode --strict-mcp-config', ''))).toBeNull()
    })

    it('refuses tools for the Claude CLI', async () => {
      const line = await generation()

      expect(runs(line.replace('--tools ""', '--tools "Bash"'))).toBeNull()
      expect(runs(line.replace('--tools ""', '--dangerously-skip-permissions --tools ""'))).toBeNull()
    })

    it('refuses files other than the ones the provider writes', async () => {
      const line = await generation()

      expect(runs(line.replace(/< '[^']*'$/, "< '/Users/someone/.ssh/id_ed25519'"))).toBeNull()
      expect(runs(line.replace(/--system-prompt-file '[^']*'/, "--system-prompt-file '/tmp'; id; '/gaimer-system-1.txt'"))).toBeNull()
    })

    it('runs only through spawn', () => {
      expect(shellRuns('execute', 'shell-cmd', ['-l', '-c', 'claude --version'])).toBeNull()
    })
  })

  describe('open-app', () => {
    it('opens Terminal', () => {
      expect(shellRuns('spawn', 'open-app', ['-a', 'Terminal'])).toEqual({ cmd: 'open', args: ['-a', 'Terminal'] })
    })

    it('opens nothing else, whatever arguments a script passes', () => {
      // The plugin passes the fixed arguments in place of the caller's
      for (const args of [['https://example.com'], ['-a', 'Calculator'], ['-a', 'Terminal', '/tmp/x.command'], []]) {
        expect(shellRuns('spawn', 'open-app', args), args.join(' ')).toEqual({ cmd: 'open', args: ['-a', 'Terminal'] })
      }
    })
  })

  describe('opener', () => {
    it('opens the Claude pricing page', () => {
      expect(openerOpens('https://claude.ai/pricing')).toBe(true)
    })

    it('opens no other kind of link', () => {
      for (const url of ['http://claude.ai/pricing', 'file:///Applications/Calculator.app', '/Applications/Calculator.app', 'mailto:someone@example.com']) {
        expect(openerOpens(url), url).toBe(false)
      }
    })
  })
})
