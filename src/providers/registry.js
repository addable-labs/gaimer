/**
 * Creates a provider registry for managing AI providers.
 *
 * All providers implement the AIProvider interface:
 *   id: string
 *   name: string
 *   authMethod: 'apikey' | 'subscription'
 *   defaultModel: string (the model generateGame uses when none is given)
 *   connect(): Promise<AuthResult>
 *   disconnect(): Promise<void>
 *   isConnected(): boolean
 *   listModels(): Promise<string[]>
 *   generateGame(prompt, options): AsyncGenerator<StreamChunk>
 *     options.parse, when given, reads the answer's text in place of
 *     safeParseGameJSON, and returns { ok, data } or { ok: false, error };
 *     an answer it cannot read fails with AnswerFormatError
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

    setActive(id) {
      if (!providers.has(id)) {
        throw new Error(`Provider "${id}" is not registered`)
      }
      activeId = id
    },

    deactivate(id) {
      if (activeId === id) {
        activeId = null
      }
    },

    getActive() {
      if (!activeId) return null
      return providers.get(activeId) || null
    },
  }
}
