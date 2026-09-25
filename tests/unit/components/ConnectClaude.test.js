import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { Quasar, QBtn } from 'quasar'
import ConnectClaude from '../../../src/components/ConnectClaude.vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { shellExec } from '../../../src/helpers/shell.js'
import { shell } from '../../plugin-shell.js'

vi.mock('../../../src/helpers/shell.js', () => ({
  shellExec: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}))

// Runs commands as the shell plugin would under the app's capability
vi.mock('@tauri-apps/plugin-shell', () => import('../../plugin-shell.js'))

// What the panel finds when it runs the Claude CLI
function claudeCli({ installed = true, signedIn = false } = {}) {
  shellExec.mockImplementation(async (command) => {
    if (!installed) throw new Error('zsh:1: command not found: claude')
    if (command === 'claude --version') return '2.1.281 (Claude Code)\n'
    if (command === 'claude auth status') return JSON.stringify({ loggedIn: signedIn }, null, 2)
    throw new Error(`Unexpected command: ${command}`)
  })
}

async function openPanel() {
  const wrapper = mount(ConnectClaude, { global: { plugins: [Quasar] } })
  await flushPromises()
  return wrapper
}

function copyButton(wrapper) {
  return wrapper.findAllComponents(QBtn).find((btn) => btn.props('icon') === 'mdi-content-copy')
}

function button(wrapper, label) {
  return wrapper.findAllComponents(QBtn).find((btn) => btn.props('label') === label)
}

enableAutoUnmount(afterEach)

describe('ConnectClaude', () => {
  let writeText

  beforeEach(() => {
    writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    shell.ran = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Copy button', () => {
    it('copies the install command when the Claude CLI is missing', async () => {
      claudeCli({ installed: false })
      const wrapper = await openPanel()

      await copyButton(wrapper).trigger('click')

      expect(writeText).toHaveBeenCalledWith('npm install -g @anthropic-ai/claude-code')
    })

    it('copies the sign-in command when the user is signed out', async () => {
      claudeCli({ signedIn: false })
      const wrapper = await openPanel()

      await copyButton(wrapper).trigger('click')

      expect(writeText).toHaveBeenCalledWith('claude auth login')
    })

    it('copies the sign-in command while the panel waits for the sign-in', async () => {
      claudeCli({ signedIn: false })
      const wrapper = await openPanel()
      await button(wrapper, 'Sign in to Claude').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Waiting for sign-in...')
      // Signing in copies the command too
      writeText.mockClear()

      await copyButton(wrapper).trigger('click')

      expect(writeText).toHaveBeenCalledWith('claude auth login')
    })
  })

  describe('Sign in button', () => {
    it('opens Terminal', async () => {
      claudeCli({ signedIn: false })
      const wrapper = await openPanel()

      await button(wrapper, 'Sign in to Claude').trigger('click')
      await flushPromises()

      expect(shell.ran).toEqual([{ cmd: 'open', args: ['-a', 'Terminal'] }])
    })
  })

  describe('pricing link', () => {
    it('opens the Claude pricing page in the browser', async () => {
      claudeCli({ installed: false })
      const wrapper = await openPanel()

      await wrapper.findAll('a').find((link) => link.text() === 'Claude Pro or Max').trigger('click')

      expect(openUrl).toHaveBeenCalledWith('https://claude.ai/pricing')
    })
  })
})
