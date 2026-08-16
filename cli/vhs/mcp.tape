Output raw/mcp.gif
Source common.tape
Set Height 1663

# 140x42. mcp-session.ts drives a real `teley mcp --local` over stdio JSON-RPC
# and prints the transcript; it clears the screen first, so the invoking command
# line stays out of the capture.

Hide
Type "export HOME=$PWD/.home && cd .. && clear"
Enter
Sleep 1s
Type "bun vhs/mcp-session.ts"
Enter
Show
Sleep 30s
