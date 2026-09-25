import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import UserInput from '../../../src/components/UserInput.vue'
import { useAppStore } from '../../../src/stores/app-store.js'

// The errors Vue caught in the component's event handlers
let errors

function showInput() {
  return mount(UserInput, {
    global: { plugins: [Quasar], config: { errorHandler: (error) => errors.push(error) } },
  })
}

function field(wrapper) {
  return wrapper.find('textarea')
}

async function pressSend(wrapper) {
  await wrapper.find('button').trigger('click')
  await flushPromises()
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

  it('sends nothing when the field holds only whitespace', async () => {
    const wrapper = showInput()
    await field(wrapper).setValue(' \n\t ')

    await pressSend(wrapper)

    expect(useAppStore().gameDescription).toBe('')
  })
})
