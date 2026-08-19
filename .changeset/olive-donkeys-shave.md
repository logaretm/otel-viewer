---
'teley-cli': minor
---

Add a metrics view. The relay has been broadcasting `metric_update` all along and the CLI dropped it on the floor, so counters, gauges, histograms, and sets now land in the TUI, `--json`, `--local`, and a `list_metrics` MCP tool alongside traces and logs. `←`/`→` cycles three views rather than toggling two.

Charts are drawn in the terminal with no dependency. A time series plots as a braille line, which packs 2x4 dots into every cell and so gives an 8-row panel 32 rows of vertical resolution; histogram buckets plot as block columns instead, since a bar's height is the whole reading and subcell smoothing would only blur where one bucket ends. Series are keyed by name _and_ attributes, so a metric split by route is several lines rather than one meaningless zigzag, and the list labels siblings with just the attribute values that differ between them.

Also pins the header's rows to one line each. It reports its own height to the layout, and the extra tab made it wrap on a narrow terminal, which pushed the panels off the bottom of the screen.
