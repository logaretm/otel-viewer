import { UI, ERROR_RED, BOLD } from '../theme';
import type { RelayStatus } from '../relay';

interface Props {
  status: RelayStatus;
  error?: string | null;
  what?: 'traces' | 'logs' | 'metrics';
}

export function EmptyState({ status, error, what = 'traces' }: Props) {
  if (status === 'rejected') {
    return (
      <box
        style={{
          flexGrow: 1,
          border: true,
          borderColor: ERROR_RED,
          backgroundColor: UI.bg,
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        <text fg={ERROR_RED} attributes={BOLD}>
          Connection rejected
        </text>
        <text fg={UI.text}>{error ?? 'The relay refused the connection.'}</text>
        <text fg={UI.dim}>
          Another viewer may already own this room, or the token is stale.
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        flexGrow: 1,
        border: true,
        borderColor: UI.border,
        backgroundColor: UI.bg,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <text fg={UI.text} attributes={BOLD}>
        {status === 'connected'
          ? `Waiting for ${what}…`
          : 'Connecting to relay…'}
      </text>
      <text fg={UI.dim}>Point your app's telemetry at the DSN above.</text>
      <text fg={UI.dim}>Press tab to select a link, then ↵ to copy it.</text>
    </box>
  );
}
