---
'teley-cli': patch
---

Answer an oversize payload with 413 rather than 400, and a CORS preflight with 204 rather than 200. The decompression ceiling and `--local`'s own body cap disagreed about the same refusal, one calling it undecodable and the other calling it too large, so the ceiling is now a distinct error and both are the one number the parsers already enforce.
