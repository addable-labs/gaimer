import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import UserInput from '../../../src/components/UserInput.vue'

describe('UserInput', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('mounts without errors', () => {
    const wrapper = mount(UserInput, {
      global: { plugins: [Quasar] }
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('does not use Document (capital D) anywhere in source', () => {
    // Regression test: Document.getElementById was the original bug
    const source = readFileSync(resolve(__dirname, '../../../src/components/UserInput.vue'), 'utf-8')
    expect(source).not.toContain('Document.getElementById')
  })
})
