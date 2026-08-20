Output raw/metrics-histogram.png
Source common.tape
Set Height 1089

# 140x27. The other renderer: a histogram's buckets as bars in the same braille
# grid, with tab held on the detail panel so the summary is beside them.

Hide
Type "export HOME=$PWD/.home && cd .. && clear"
Enter
Sleep 1s
Type "bun run src/index.tsx --demo"
Enter
Sleep 8s
Show
Sleep 1s

Right 1
Sleep 500ms
Right 1
Sleep 1s

# Down to http.server.request.duration, then tab for the stats panel.
Down 4
Sleep 1500ms
Tab
Sleep 2s

Screenshot raw/metrics-histogram.png
Sleep 2s
