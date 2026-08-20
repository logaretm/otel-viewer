---
'teley-cli': minor
---

Add a metrics view. The relay has been broadcasting `metric_update` all along and the CLI dropped it on the floor, so counters, gauges, histograms, and sets now land in the TUI, `--json`, `--local`, and a `list_metrics` MCP tool alongside traces and logs. `←`/`→` cycles three views rather than toggling two.

Charts are drawn in the terminal with no dependency, out of braille: a cell carries 2x4 dots, so an 8-row panel plots at 32 rows of vertical resolution and every column is addressable at half-cell precision. A time series draws as a line through those dots, histogram buckets as filled bars in the same grid. Series are keyed by name _and_ attributes, so a metric split by route is several lines rather than one meaningless zigzag, and the list labels siblings with just the attribute values that differ between them.

When a panel is too narrow to carry both a scale and a plot, the scale is what gives: the chart drops its axis and keeps drawing, rather than refusing and asking for a wider terminal.

Also pins the header's rows to one line each. It reports its own height to the layout, and the extra tab made it wrap on a narrow terminal, which pushed the panels off the bottom of the screen.
