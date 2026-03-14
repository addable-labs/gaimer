/**
 * Creates a provider registry for managing AI providers.
 *
 * All providers implement the AIProvider interface:
 *   id: string
 *   name: string
 *   authMethod: 'oauth' | 'apikey' | 'local'
 *   connect(): Promise<AuthResult>
 *   disconnect(): Promise<void>
 *   isConnected(): boolean
 *   generateGame(prompt, options): AsyncGenerator<StreamChunk>
 *   generateSprite(description, style): Promise<SpriteResult>
 *   capabilities: { streaming, imageGeneration, maxOutputTokens, sandboxedExecution }
 */
export function createProviderRegistry() {
  const providers = new Map()
  let activeId = null

  return {
    register(provider) {
      providers.set(provider.id, provider)
    },

    get(id) {
      return providers.get(id) || null
    },

    list() {
      return Array.from(providers.values())
    },

    remove(id) {
      providers.delete(id)
      if (activeId === id) {
        activeId = null
      }
    },

    setActive(id) {
      if (!providers.has(id)) {
        throw new Error(`Provider "${id}" is not registered`)
      }
      activeId = id
    },

    getActive() {
      if (!activeId) return null
      return providers.get(activeId) || null
    },
  }
}
