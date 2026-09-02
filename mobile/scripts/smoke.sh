#!/bin/sh
# Record -> stop -> upload, end to end, on the iOS simulator against the stub worker.
#
# The simulator only accepts synthesized input through macOS Accessibility (the
# Simulator bridges the app's AX tree to the host); posted mouse events are dropped.
# `macos-harness` presses the AX buttons; everything else is `simctl`.
#
# Start the stub first:
#   bun mobile/scripts/stub-worker.ts --port 8787 --out /tmp/stub-worker.json
#
# Usage: mobile/scripts/smoke.sh [simulator-udid]
set -eu

project_dir=$(cd "$(dirname "$0")/.." && pwd)
bundle_id=com.aktanazat.sona.mobile
endpoint=http://127.0.0.1:8787
vault_id=stub_vault_00000001
device=${1:-$(xcrun simctl list devices available --json | /usr/bin/python3 -c 'import json,sys
for runtime, entries in json.load(sys.stdin)["devices"].items():
    for entry in entries:
        if entry["name"] == "iPhone 16":
            print(entry["udid"])
            raise SystemExit')}

# A derived-data directory that has already produced one successful build sometimes
# makes xcodebuild report the iOS platform as missing; retry until it resolves.
derived=${TMPDIR:-/tmp}/sona-smoke-dd
attempt=1
while [ "$attempt" -le 25 ]; do
  if xcodebuild -project "$project_dir/Sona.xcodeproj" -scheme Sona \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" build \
      >/tmp/sona-smoke-build.log 2>&1; then
    break
  fi
  grep -q "Unable to find a destination" /tmp/sona-smoke-build.log || {
    tail -30 /tmp/sona-smoke-build.log
    exit 1
  }
  attempt=$((attempt + 1))
  sleep 15
done

xcrun simctl bootstatus "$device" -b >/dev/null 2>&1 || xcrun simctl boot "$device" || true
xcrun simctl terminate "$device" "$bundle_id" 2>/dev/null || true
xcrun simctl install "$device" "$derived/Build/Products/Debug-iphonesimulator/Sona.app"
xcrun simctl privacy "$device" grant microphone "$bundle_id"
xcrun simctl launch "$device" "$bundle_id"
sleep 4

press() {
  macos-harness <<PY || true
mac.ax.press("$1", role="button", app="Simulator")
PY
  sleep "${2:-2}"
}

set_field() {
  macos-harness <<PY
res = mac.ax.query("", app="Simulator", max_nodes=250)
fields = {r.get("value"): r["element_index"] for r in res if r["role"] == "AXTextField"}
mac.ax.set(fields["$1"], "AXValue", "$2")
PY
}

press "I understand"
press gearshape
set_field Address "$endpoint"
set_field "Vault id" "$vault_id"
press "Create pairing code" 3
press "Copy pairing code"
xcrun simctl pbpaste "$device" > /tmp/sona-offer.json
bun "$project_dir/scripts/approve-pairing.ts" /tmp/sona-offer.json "$endpoint"
macos-harness <<'PY'
mac.key("return", app="Simulator")
PY
sleep 2
press "Finish pairing" 4
press Done
press Record 10
mkdir -p "$project_dir/docs"
xcrun simctl io "$device" screenshot "$project_dir/docs/recording.png"
press Stop 8

/usr/bin/python3 -c "
import json
events = json.load(open('/tmp/stub-worker.json'))
committed = [e for e in events if e['kind'] == 'committed']
print(json.dumps(events, indent=1))
raise SystemExit(0 if committed and committed[-1]['audio_digest_matches'] else 1)"
