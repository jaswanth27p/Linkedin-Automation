import { render } from '@opentui/solid'
import { createCliRenderer, CliRenderer, engine } from '@opentui/core'
import { App } from './App.tsx'

let rendererInstance: CliRenderer | null = null

export async function mountTui(): Promise<void> {
  return new Promise<void>(async (resolve) => {
    rendererInstance = await createCliRenderer({
      // Ctrl+C must not kill the renderer — we bind it to "copy selection"
      // in App.tsx instead (see there). Terminal-native select+copy can't
      // work in a live-repainting TUI (the 30fps repaint wipes the marked
      // text), so we use opentui's OWN mouse selection + OSC52 clipboard
      // copy — which requires mouse reporting left ON (the default). Same
      // approach opencode uses.
      exitOnCtrlC: false,
      onDestroy: () => {
        rendererInstance = null
        resolve()
      },
    })
    engine.attach(rendererInstance)
    render(() => <App />, rendererInstance)
  })
}

export function destroyTui(): void {
  if (rendererInstance) {
    rendererInstance.destroy()
  }
}
