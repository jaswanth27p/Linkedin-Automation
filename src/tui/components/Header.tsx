import { appState } from '../../state/app-state.ts'
import { theme } from '../theme.ts'

export function Header() {
  const statusText = () => {
    const s = appState.session
    if (s.linkedin) return 'LinkedIn connected'
    return 'Waiting for login: LinkedIn'
  }

  return (
    <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} height={3}>
      <text fg={theme.text}>LinkedIn Auto-Apply — {statusText()}</text>
    </box>
  )
}
