import { Dashboard } from './components/Dashboard';
import { useLiveData } from './relay';
import type { Endpoints } from './session';
import type { TelemetrySource } from './source';

// Live mode: streams real traces + logs from the room's source (the relay, or
// the local ingest server under --local).
export function LiveApp({
  endpoints,
  source,
  onQuit,
}: {
  endpoints: Endpoints;
  source: TelemetrySource;
  onQuit: () => void;
}) {
  const { status, error, viewers, traces, logs, clear } = useLiveData(source);
  return (
    <Dashboard
      endpoints={endpoints}
      status={status}
      error={error}
      viewers={viewers}
      traces={traces}
      logs={logs}
      onClear={clear}
      onQuit={onQuit}
    />
  );
}
