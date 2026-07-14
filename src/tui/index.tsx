import { render } from '@opentui/solid'
import { createCliRenderer, CliRenderer, engine } from '@opentui/core'
import { App } from './App.tsx'

let rendererInstance: CliRenderer | null = null

export async function mountTui(): Promise<void> {
  return new Promise<void>(async (resolve) => {
    rendererInstance = await createCliRenderer({
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
