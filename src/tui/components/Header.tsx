import { appState } from '../../state/app-state.ts'
import { theme } from '../theme.ts'

export function Header() {
  const statusText = () => {
    const s = appState.session
    if (s.linkedin && s.gmail) return 'LinkedIn + Gmail connected'
    const waiting = [!s.linkedin && 'LinkedIn', !s.gmail && 'Gmail'].filter(Boolean).join(' + ')
    return `Waiting for login: ${waiting}`
  }

  return (
    <box border borderColor={theme.border} paddingLeft={1} paddingRight={1} height={3}>
      <text fg={theme.text}>LinkedIn Auto-Apply — {statusText()}</text>
    </box>
  )
}
