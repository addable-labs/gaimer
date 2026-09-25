import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import UserInput from '../../../src/components/UserInput.vue'
import { useAppStore } from '../../../src/stores/app-store.js'

// The errors Vue caught in the component's event handlers
let errors

// Mounted in the page, so that the field can hold the focus
function showInput() {
  return mount(UserInput, {
    attachTo: document.body,
    global: { plugins: [Quasar], config: { errorHandler: (error) => errors.push(error) } },
  })
}

function field(wrapper) {
  return wrapper.find('textarea')
}

// A press with the mouse. As in a browser, the send button then holds the
// focus when it is clicked: Quasar's QBtn moves the focus to itself at mouseup
async function pressSend(wrapper) {
  const button = wrapper.find('button')
  await button.trigger('mousedown')
  await button.trigger('mouseup')
  await button.trigger('click')
  await flushPromises()
}

// What in the field holds the focus
function focused(wrapper) {
  const element = document.activeElement
  if (element === field(wrapper).element) return 'the textarea'
  if (wrapper.find('button').element.contains(element)) return 'the send button'
  return wrapper.element.contains(element) ? 'another part of the field' : 'nothing'
}

enableAutoUnmount(afterEach)

describe('UserInput', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    errors = []
  })

  it('mounts without errors', () => {
    const wrapper = mount(UserInput, {
      global: { plugins: [Quasar] }
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('sends the description without the whitespace around it, and empties the field', async () => {
    const wrapper = showInput()
    await field(wrapper).setValue('  A game of pong\n\n')

    await pressSend(wrapper)

    expect(useAppStore().gameDescription).toBe('A game of pong')
    expect(field(wrapper).element.value).toBe('')
    // Sending once failed at its end, calling Document.getElementById
    expect(errors).toEqual([])
  })

  it('sends the description on Cmd+Enter', async () => {
    const wrapper = showInput()
    await field(wrapper).setValue('A game of pong')

    await field(wrapper).trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()

    expect(useAppStore().gameDescription).toBe('A game of pong')
    expect(errors).toEqual([])
  })

  it('takes the focus off the field after sending with the send button', async () => {
    const wrapper = showInput()
    field(wrapper).element.focus()
    await field(wrapper).setValue('A game of pong')
    expect(focused(wrapper)).toBe('the textarea')

    await pressSend(wrapper)

    expect(useAppStore().gameDescription).toBe('A game of pong')
    expect(focused(wrapper)).toBe('nothing')
  })

  it('takes the focus off the field after sending on Cmd+Enter', async () => {
    const wrapper = showInput()
    field(wrapper).element.focus()
    await field(wrapper).setValue('A game of pong')
    expect(focused(wrapper)).toBe('the textarea')

    await field(wrapper).trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()

    expect(useAppStore().gameDescription).toBe('A game of pong')
    expect(focused(wrapper)).toBe('nothing')
  })

  it('sends nothing when the field holds only whitespace', async () => {
    const wrapper = showInput()
    await field(wrapper).setValue(' \n\t ')

    await pressSend(wrapper)

    expect(useAppStore().gameDescription).toBe('')
  })
})
