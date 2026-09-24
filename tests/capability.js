// How Tauri 2.11 and tauri-plugin-shell 2.3 read the main window's
// capability, src-tauri/capabilities/default.json, so tests can check what a
// script in the window may run. It models what that file uses and throws on
// permissions it does not model.
import capability from '../src-tauri/capabilities/default.json'

// The scope entries the capability gives a command of a plugin, such as
// spawn of the shell plugin, or null when it does not grant the command.
// Tauri grants a command through the plugin's allow-<command> permission and
// gives the command only the scope written on those permissions.
function commandScope(plugin, command) {
  let entries = null
  for (const permission of capability.permissions) {
    const { identifier, ...scope } = typeof permission === 'string' ? { identifier: permission } : permission
    if (!identifier.startsWith(`${plugin}:`)) continue
    if (!identifier.startsWith(`${plugin}:allow-`) || scope.deny) {
      throw new Error(`${identifier} is not modelled`)
    }
    if (identifier === `${plugin}:allow-${command.replaceAll('_', '-')}`) {
      entries = [...(entries ?? []), ...(scope.allow ?? [])]
    }
  }
  return entries
}

// Whether the capability grants a command of a plugin
export function grants(plugin, command) {
  return commandScope(plugin, command) !== null
}

// The plugin matches with Rust's regex crate, which reads \d \w \s \b \p as
// Unicode and . as anything but \n, and has no lookaround or backreferences.
// A validator without these means the same there as in JavaScript.
const unportable = /\\[dDwWsSbBpP1-9]|\(\?[^:]|(?<!\\)\.(?![^[]*\])/

// The process tauri-plugin-shell starts for Command.create(program, args)
// run with spawn() or execute(), as { cmd, args }, or null when it refuses.
// The plugin uses the first scope entry named program. It passes a fixed
// argument as written, whatever the caller gave. A validator must match the
// caller's argument at its position, anchored as ^validator$ unless raw is
// set. Arguments past the entry's list are dropped.
export function shellRuns(command, program, args) {
  const entry = commandScope('shell', command)?.find((entry) => entry.name === program)
  if (!entry || entry.sidecar) return null
  if (entry.args === true) return { cmd: entry.cmd, args }

  const run = []
  for (const [i, arg] of (entry.args || []).entries()) {
    if (typeof arg === 'string') {
      run.push(arg)
      continue
    }
    if (unportable.test(arg.validator)) {
      throw new Error(`${arg.validator} may match differently in Rust`)
    }
    const validator = new RegExp(arg.raw ? arg.validator : `^${arg.validator}$`)
    if (args[i] === undefined || !validator.test(args[i])) return null
    run.push(args[i])
  }
  return { cmd: entry.cmd, args: run }
}
