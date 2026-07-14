import { createSignal } from 'solid-js'
import { theme } from '../theme.ts'

export function InputBar(props: { onSubmit: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = createSignal('')

  return (
    <box border borderColor={theme.border} height={3} paddingLeft={1} paddingRight={1}>
      <input
        value={value()}
        placeholder={props.disabled ? 'Waiting for browser login...' : 'Type a /command'}
        onInput={setValue}
        onSubmit={() => {
          if (!value().trim()) return
          props.onSubmit(value())
          setValue('')
        }}
      />
    </box>
  )
}
