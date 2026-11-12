# Runs all test suites and writes VERIFICATION_REPORT.md
$repo = Split-Path -Parent $PSScriptRoot
& "$repo\backend\.venv\Scripts\python.exe" "$repo\scripts\verify.py"
exit $LASTEXITCODE
