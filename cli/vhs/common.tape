# Shared capture settings. Sourced by every tape in this directory.
#
# The grid is pinned to 140 columns: 2464px wide at a 2x pixel ratio, 28px
# padding, SF Mono at 26px (13px logical). Each tape sets its own Height, which
# is 56 + rows * 38.26. Colours are the app's zinc palette on zinc-950, so the
# capture already looks like the TUI before frame.py wraps it.
#
# Output is the raw terminal only. The window chrome, gradient, and shadow are
# added afterwards by frame.py.

Set Shell "zsh"
Set FontFamily "SF Mono"
Set FontSize 26
Set LineHeight 1.2
Set Padding 28
Set Width 2464
Set Framerate 24
Set Theme { "background": "#09090b", "foreground": "#d4d4d8", "cursor": "#d4d4d8", "selection": "#27272a", "black": "#18181b", "red": "#ef4444", "green": "#22c55e", "yellow": "#f59e0b", "blue": "#3b82f6", "magenta": "#a855f7", "cyan": "#06b6d4", "white": "#d4d4d8", "brightBlack": "#71717a", "brightRed": "#f87171", "brightGreen": "#4ade80", "brightYellow": "#fbbf24", "brightBlue": "#60a5fa", "brightMagenta": "#c084fc", "brightCyan": "#22d3ee", "brightWhite": "#f4f4f5" }
