// A fake @tauri-apps/plugin-shell that starts no process. It refuses a
// command the way Tauri would under the app's capability (see
// capability.js), and records what the real plugin would have started and
// killed.
import { grants, shellRuns } from './capability.js'

export const shell = {
  // { cmd, args } of each process the plugin would have started
  ran: [],
  // What a started process prints, given its { cmd, args }
  output: () => '',
  // Whether a started process exits once it has printed, given its
  // { cmd, args }; one that does not keeps running
  exits: () => true,
  // Each process that keeps running, as { process, exit }; exit() ends it
  running: [],
  // { cmd, args } of each process a script asked the plugin to kill
  killed: [],
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

// A process that spawn() started
class Child {
  constructor(pid, process) {
    this.pid = pid
    this.process = process
  }

  // Kills the process through the plugin command kill
  async kill() {
    if (!grants('shell', 'kill')) {
      throw new Error('shell.kill not allowed. Permissions associated with this command: shell:allow-kill')
    }
    shell.killed.push(this.process)
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
  // returns the process
  run(pluginCommand) {
    const process = shellRuns(pluginCommand, this.program, this.args)
    if (!process) {
      throw new Error(`program not allowed on the configured shell scope: ${this.program}`)
    }
    shell.ran.push(process)
    return process
  }

  async spawn() {
    const process = this.run('spawn')
    this.stdout.emit('data', shell.output(process))
    const exit = () => this.emit('close', { code: 0, signal: null })
    if (shell.exits(process)) exit()
    else shell.running.push({ process, exit })
    return new Child(shell.ran.length, process)
  }

  async execute() {
    const process = this.run('execute')
    return { code: 0, signal: null, stdout: shell.output(process), stderr: '' }
  }
}
