Output raw/metrics.png
Source common.tape
Set Height 1089

# 140x27. The metrics view on a gauge that is split by pool, so both renderers'
# inputs are visible at once: the braille line in the chart, and two sibling
# series in the list separated by the attribute values that differ.

Hide
Type "export HOME=$PWD/.home && cd .. && clear"
Enter
Sleep 1s
Type "bun run src/index.tsx --demo"
Enter
Sleep 8s
Show
Sleep 1s

# traces -> logs -> metrics.
Right 1
Sleep 800ms
Right 1
Sleep 2s

# Down onto db.client.connections.usage{primary}.
Down 1
Sleep 2s

Screenshot raw/metrics.png
Sleep 2s
