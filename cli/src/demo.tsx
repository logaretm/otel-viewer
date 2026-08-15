import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { MOCK_TRACES, buildMockLogs } from './mock-data';
import type { Endpoints } from './session';

// Demo mode (--demo): renders the mock data with no network connection. Kept in
// its own module so the sample data is only loaded (and built) when asked for.
export function DemoApp({
  endpoints,
  onQuit,
}: {
  endpoints: Endpoints;
  onQuit: () => void;
}) {
  const [traces, setTraces] = useState(MOCK_TRACES);
  const [logs, setLogs] = useState(buildMockLogs);
  return (
    <Dashboard
      endpoints={endpoints}
      status="connected"
      viewers={1}
      traces={traces}
      logs={logs}
      onClear={() => {
        setTraces([]);
        setLogs([]);
      }}
      onQuit={onQuit}
    />
  );
}
