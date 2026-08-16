Output raw/navigation.gif
Source common.tape
Set Height 1089

# 140x27. The trace list, the waterfall, the header links, and the log stream,
# walked in that order so every row of the key table appears at least once.

Hide
Type "export HOME=$PWD/.home && cd .. && clear"
Enter
Sleep 1s
Type "bun run src/index.tsx --demo"
Enter
Sleep 8s
Show

# Trace list focused: move between traces.
Sleep 2s
Down 1
Sleep 1400ms
Down 1
Sleep 1600ms
Up 1
Sleep 1200ms
Up 1
Sleep 1800ms

# tab -> waterfall. The trace list collapses and the span panel appears.
Tab
Sleep 2s

# Walk the spans; the attribute panel follows the selection.
Down 1
Sleep 1200ms
Down 1
Sleep 1200ms
Down 1
Sleep 1200ms
Down 1
Sleep 1200ms
Down 1
Sleep 2200ms

# tab -> the connection links in the header, then copy the OTLP endpoint.
Tab
Sleep 1800ms
Down 1
Sleep 1400ms
Type "y"
Sleep 2600ms

# tab -> back to the list, then switch views.
Tab
Sleep 1600ms
Right 1
Sleep 2s

# Logs view: walk the stream, the detail panel follows.
Down 1
Sleep 1200ms
Down 1
Sleep 1200ms
Down 1
Sleep 2200ms

Left 1
Sleep 2s
