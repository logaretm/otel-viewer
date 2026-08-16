Output raw/local.png
Source common.tape
Set Height 1089

# 140x27. --local makes this process the ingest endpoint, so the endpoints in
# the header are on localhost. record.sh posts a real trace to it from outside
# this pty; doing it in here would print job control output over the TUI.

Hide
Type "export HOME=$PWD/.home && cd .. && clear"
Enter
Sleep 1s
Type "bun run src/index.tsx --local"
Enter
Sleep 20s
Show
Sleep 1s

Screenshot raw/local.png
Sleep 2s
