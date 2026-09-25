import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import GameContainer from '../../../src/components/GameContainer.vue'

vi.mock('../../../src/helpers/game-storage.js', () => ({
  saveGameState: vi.fn(async () => {}),
  loadGameState: vi.fn(async () => null),
}))

// happy-dom's ResizeObserver never reports, so the tests report sizes
// through this stand-in, as the browser would
const resizeObservers = new Set()
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe(element) {
    this.element = element
    resizeObservers.add(this)
  }
  unobserve() {}
  disconnect() {
    resizeObservers.delete(this)
  }
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

// Sets the size the game's container measures
function setContainerSize(wrapper, { width, height }) {
  const container = wrapper.find('.game-canvas-wrapper').element
  container.getBoundingClientRect = () => new DOMRect(0, 0, width, height)
}

// Shows a game in a container of the given size
async function showGame(size) {
  const wrapper = mount(GameContainer, {
    props: { game: { code: '// game', controls: 'Arrow keys', rules: 'Catch the stars' } },
    attachTo: document.body,
    global: { plugins: [Quasar] },
  })
  setContainerSize(wrapper, size)
  await flushPromises()
  return wrapper
}

// Resizes the container as resizing the window does: the window reports a
// resize, and the container's resize observers report its new size
async function resizeContainer(wrapper, size) {
  setContainerSize(wrapper, size)
  window.dispatchEvent(new Event('resize'))
  for (const observer of resizeObservers) {
    observer.callback([{ target: observer.element }], observer)
  }
  // Longer than any debounce of the resize
  await vi.advanceTimersByTimeAsync(1000)
}

enableAutoUnmount(afterEach)

describe('GameContainer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    // The component logs when it loads a game
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps the game running when the window is resized, scaled to fit', async () => {
    const wrapper = await showGame({ width: 800, height: 600 })
    const iframe = wrapper.find('iframe').element
    const page = iframe.srcdoc
    expect(page).toContain('<canvas id="game-canvas" width="800" height="600">')

    await resizeContainer(wrapper, { width: 400, height: 600 })

    // The same iframe with the same page: the game was not loaded again
    expect(wrapper.findAll('iframe')).toHaveLength(1)
    expect(wrapper.find('iframe').element).toBe(iframe)
    expect(iframe.srcdoc).toBe(page)
    // Half its size, centred in the narrower container
    expect(iframe.style.transform).toBe('translate(0px, 150px) scale(0.5)')

    await resizeContainer(wrapper, { width: 800, height: 600 })
    expect(wrapper.find('iframe').element).toBe(iframe)
    expect(iframe.style.transform).toBe('translate(0px, 0px) scale(1)')
  })
})
