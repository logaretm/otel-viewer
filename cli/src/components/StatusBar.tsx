import { UI, BOLD } from '../theme';

type Focus = 'list' | 'detail' | 'links';

function Key({ k, label }: { k: string; label: string }) {
  return (
    <>
      <text fg={UI.text} attributes={BOLD}>{` ${k}`}</text>
      <text fg={UI.dim}>{` ${label}`}</text>
    </>
  );
}

function Sep() {
  return <text fg={UI.dim}>{'   '}</text>;
}

export function StatusBar({
  focus,
  canScroll,
}: {
  focus: Focus;
  canScroll: boolean;
}) {
  return (
    <box style={{ flexDirection: 'row', paddingLeft: 1 }}>
      {focus === 'links' ? (
        <>
          <Key k="↑↓" label="select link" />
          <Sep />
          <Key k="↵" label="copy" />
        </>
      ) : (
        <>
          <Key k="↑↓" label="navigate" />
          {/* Only offered when the focused detail panel actually overflows. */}
          {canScroll ? (
            <>
              <Sep />
              <Key k="⇞⇟" label="scroll" />
            </>
          ) : null}
          <Sep />
          <Key k="c" label="clear" />
        </>
      )}
      <Sep />
      <Key k="←→" label="view" />
      <Sep />
      <Key k="tab" label="focus" />
      <Sep />
      <Key k="q" label="quit" />
    </box>
  );
}
