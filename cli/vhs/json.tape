Output raw/json.png
Source common.tape
Set Height 592

# 140x14. Three real runs against the demo data: the session line piped to jq,
# then every trace, then only the ones that failed.

Hide
Type "export HOME=$PWD/.home && cd .."
Enter
Type `alias teley='bun run src/index.tsx'`
Enter
Type "clear"
Enter
Sleep 1500ms
Show

Type `teley --json --demo | head -1 | jq '{room_id, dsn, otlp}'`
Enter
Sleep 4s

Type `teley --json --demo | jq -c 'select(.type=="trace") | [.trace.service_name, .trace.operation_name, .trace.duration]'`
Enter
Sleep 4s

Type `teley --json --demo | jq -r 'select(.type=="trace" and .trace.status_code==2) | .trace.operation_name'`
Enter
Sleep 4s

Screenshot raw/json.png
Sleep 2s
