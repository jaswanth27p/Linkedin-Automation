import { render } from '@opentui/solid'
import { App } from './App.tsx'

export async function mountTui(): Promise<void> {
  await render(() => <App />)
}
