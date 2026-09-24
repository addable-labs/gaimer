// A fake @tauri-apps/plugin-shell that starts no process. It refuses a
// command the way Tauri would under the app's capability (see
// capability.js), and records what the real plugin would have started.
import { shellRuns } from './capability.js'

export const shell = {
  // { cmd, args } of each process the plugin would have started
  ran: [],
  // What a started process prints, given its { cmd, args }
  output: () => '',
}

class Emitter {
  handlers = {}

  on(event, handler) {
    (this.handlers[event] ??= []).push(handler)
    return this
  }

  emit(event, payload) {
    for (const handler of this.handlers[event] ?? []) handler(payload)
  }
}

export class Command extends Emitter {
  stdout = new Emitter()
  stderr = new Emitter()

  static create(program, args = []) {
    return new Command(program, args)
  }

  constructor(program, args) {
    super()
    this.program = program
    this.args = typeof args === 'string' ? [args] : args
  }

  // Runs the command through the plugin command spawn or execute, and
  // returns what it prints
  run(pluginCommand) {
    const process = shellRuns(pluginCommand, this.program, this.args)
    if (!process) {
      throw new Error(`program not allowed on the configured shell scope: ${this.program}`)
    }
    shell.ran.push(process)
    return shell.output(process)
  }

  async spawn() {
    this.stdout.emit('data', this.run('spawn'))
    this.emit('close', { code: 0, signal: null })
    return { pid: shell.ran.length }
  }

  async execute() {
    return { code: 0, signal: null, stdout: this.run('execute'), stderr: '' }
  }
}
