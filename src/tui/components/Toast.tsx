import { createSignal, Show } from 'solid-js'
import { theme } from '../theme.ts'

const [message, setMessage] = createSignal<string | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

/** Show a transient toast (e.g. "Copied to clipboard") that auto-dismisses. */
export function showToast(text: string, durationMs = 1800): void {
  setMessage(text)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    setMessage(null)
    timer = null
  }, durationMs)
}

/** Absolute-positioned overlay pinned to the top-right; render once at the app root. */
export function ToastOverlay() {
  return (
    <Show when={message()}>
      <box
        position="absolute"
        top={1}
        right={2}
        zIndex={3000}
        border
        borderColor={theme.success}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.success}>✓ {message()}</text>
      </box>
    </Show>
  )
}
