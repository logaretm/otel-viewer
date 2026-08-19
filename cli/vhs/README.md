# Recording the CLI screenshots

The CLI images in `docs/screenshots/` are generated from this directory, so they
can be reshot when the TUI changes instead of being redrawn by hand.

```sh
./record.sh              # all of them
./record.sh navigation   # just one, by tape name
```

Output goes straight to `docs/screenshots/`. Raw captures are kept in `raw/` for
inspection and are gitignored.

| Tape                     | Produces                          | Shows                                             |
| ------------------------ | --------------------------------- | ------------------------------------------------- |
| `navigation.tape`        | `teley-cli-navigation.gif`        | Every key in the readme's key table, in order     |
| `metrics.tape`           | `teley-cli-metrics.png`           | A gauge as a braille line, split into two series  |
| `metrics-histogram.tape` | `teley-cli-metrics-histogram.png` | A histogram's buckets as block columns            |
| `mcp.tape`               | `teley-cli-mcp.gif`               | The MCP loop against a real `teley mcp --local`   |
| `json.tape`              | `teley-cli-json.png`              | `--json` piped through `jq`                       |
| `local.tape`             | `teley-cli-local.png`             | `--local`, with localhost endpoints in the header |

## Prerequisites

- [vhs](https://github.com/charmbracelet/vhs): `brew install vhs`
- Python with Pillow, for `frame.py`
- **SF Mono registered as a font family.** macOS ships it inside Terminal.app
  but does not expose it to other apps, so Chrome (which is what vhs renders
  through) falls back to a proportional serif and the grid comes out wrong:

  ```sh
  cp /System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts/SF-Mono-{Regular,Bold,RegularItalic,BoldItalic}.otf ~/Library/Fonts/
  ```

## How it works

Two stages, because vhs can produce the terminal but not the house treatment.

**Capture.** `common.tape` pins the grid to 140x27 (2464px wide at a 2x pixel
ratio, SF Mono 26px, 28px padding) and sets the app's zinc palette on zinc-950,
so the raw capture already looks like the TUI. Each tape sets its own `Height`,
which is `56 + rows * 38.26`. Output is the bare terminal, no window chrome.

**Frame.** `frame.py` adds the mesh gradient, window chrome, and shadow
specified in the repo `CLAUDE.md` under "README Screenshots". It is the
executable copy of that spec, so the two have to move together. It handles both
stills and animations, reusing the gradient and the blurred shadow across
frames and quantizing every frame against one palette so the static background
costs almost nothing per frame.

## Notes

- The recordings run against a throwaway room (`Kq7mXt2vB9dL`) written to
  `.home/.teley/session.json`, so no published image carries a real room id.
- `record.sh` posts the `--local` trace from outside the recording pty. A
  background job started inside it prints job control output over the TUI.
- `mcp-session.ts` calls `wait_for_traces` while the app under test is still
  running. That tool only reports what arrives after it is called, so calling
  it once a short-lived app has exited returns nothing.
- Animations are written at the same 2000px as the stills. vhs records at a
  fixed framerate, so a 33s navigation capture arrives as 832 frames of which
  only 21 differ from the one before; `frame.py` collapses the duplicates and
  adds their durations together, which is what pays for the full width.
