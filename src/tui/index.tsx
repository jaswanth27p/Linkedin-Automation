import { render } from '@opentui/solid'
import { createCliRenderer, CliRenderer, engine } from '@opentui/core'
import { App } from './App.tsx'

let rendererInstance: CliRenderer | null = null

export async function mountTui(): Promise<void> {
  // NOT `new Promise(async (resolve) => {...})` (the previous shape here): an
  // async executor's body runs as its own detached microtask, so any throw
  // inside it (createCliRenderer, render()) becomes an unhandled rejection
  // that never reaches this function's caller at all — it bypasses main()'s
  // try/catch and the pino logger entirely, and prints raw straight over the
  // TUI's frame instead (the "unreadable, uncopyable error on top of the
  // TUI" failure mode). Doing the async setup in this real async function
  // (whose own rejection DOES propagate to the caller via `await mountTui()`)
  // and keeping the Promise executor itself synchronous fixes that.
  const renderer = await createCliRenderer({
    // Ctrl+C must not kill the renderer — we bind it to "copy selection"
    // in App.tsx instead (see there). Terminal-native select+copy can't
    // work in a live-repainting TUI (the 30fps repaint wipes the marked
    // text), so we use opentui's OWN mouse selection + OSC52 clipboard
    // copy — which requires mouse reporting left ON (the default). Same
    // approach opencode uses.
    exitOnCtrlC: false,
    onDestroy: () => {
      rendererInstance = null
    },
  })
  rendererInstance = renderer

  return new Promise<void>((resolve, reject) => {
    // CliRenderer extends EventEmitter and emits 'destroy' from inside its
    // own destroy() (before the onDestroy callback above runs) — listening
    // here, rather than threading another callback through the config, needs
    // no assumption about what else destroy() does internally.
    renderer.once('destroy', () => resolve())
    try {
      engine.attach(renderer)
      render(() => <App />, renderer)
    } catch (err) {
      reject(err)
    }
  })
}

export function destroyTui(): void {
  if (rendererInstance) {
    rendererInstance.destroy()
  }
}
