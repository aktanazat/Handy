#!/bin/sh
# Record -> stop -> upload, end to end, on the iOS simulator against the stub worker.
#
# The simulator only accepts synthesized input through macOS Accessibility (the
# Simulator bridges the app's AX tree to the host); posted mouse events are dropped.
# `macos-harness` presses the AX buttons; everything else is `simctl`.
#
# Start the stub first, writing to the file this script reads. One variable
# feeds both sides:
#   export SONA_SMOKE_EVENTS=/private/var/tmp/stub-worker.json
#   bun mobile/scripts/stub-worker.ts --port 8787 --out "$SONA_SMOKE_EVENTS"
#
# Usage: mobile/scripts/smoke.sh [simulator-udid]
set -eu

project_dir=$(cd "$(dirname "$0")/.." && pwd)
bundle_id=com.aktanazat.sona.mobile
endpoint=http://127.0.0.1:8787
vault_id=stub_vault_00000001
scratch=${TMPDIR:-/private/var/tmp}
build_log=$scratch/sona-smoke-build.log
offer=$scratch/sona-offer.json
events=${SONA_SMOKE_EVENTS:-$scratch/stub-worker.json}
screenshot=$scratch/sona-mobile-recording.png
device=${1:-$(xcrun simctl list devices available --json | /usr/bin/python3 -c 'import json,sys
for runtime, entries in json.load(sys.stdin)["devices"].items():
    for entry in entries:
        if entry["name"] == "iPhone 16":
            print(entry["udid"])
            raise SystemExit')}
cleanup() {
  xcrun simctl terminate "$device" "$bundle_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# A derived-data directory that has already produced one successful build sometimes
# makes xcodebuild report the iOS platform as missing; retry until it resolves.
derived=$scratch/sona-smoke-dd
attempt=1
while [ "$attempt" -le 25 ]; do
  if xcodebuild -project "$project_dir/Sona.xcodeproj" -scheme Sona \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" build \
      >"$build_log" 2>&1; then
    break
  fi
  grep -q "Unable to find a destination" "$build_log" || {
    tail -30 "$build_log"
    exit 1
  }
  attempt=$((attempt + 1))
  sleep 15
done

xcrun simctl bootstatus "$device" -b >/dev/null 2>&1 || xcrun simctl boot "$device" || true
/usr/bin/open -g -a Simulator --args -CurrentDeviceUDID "$device"
sleep 2
xcrun simctl terminate "$device" "$bundle_id" 2>/dev/null || true
xcrun simctl uninstall "$device" "$bundle_id" 2>/dev/null || true
xcrun simctl install "$device" "$derived/Build/Products/Debug-iphonesimulator/Sona.app"
xcrun simctl privacy "$device" grant microphone "$bundle_id"
xcrun simctl launch "$device" "$bundle_id"
sleep 4

# One AX button press against the Simulator's bridged tree.
#   $1 button label, matched exactly against title, value or description
#   $2 seconds to settle afterwards (default 2)
#   $3 policy: `required` (default) fails when the button is absent,
#      `optional` accepts zero matches, `stopping` also accepts an action that
#      has already gone unavailable, which is that button doing its job.
# More than one match is always fatal: the press would be a coin flip.
press() {
  macos-harness <<PY
from macos_harness.errors import ErrorCode, MacOSError
matches = mac.ax.query_all("$1", role="button", apps="Simulator", limit=10, attributes=["AXTitle", "AXValue", "AXDescription"])
exact = [item for item in matches if "$1" in (item.get("title"), item.get("value"), item.get("description"))]
if len(exact) > 1 or (not exact and "${3:-required}" == "required"):
    raise RuntimeError(f"expected a single '$1' button, found {len(exact)}")
if exact:
    try:
        mac.ax.perform(exact[0]["element_index"], "AXPress")
    except MacOSError as error:
        if "${3:-required}" != "stopping" or error.code != ErrorCode.AX_ERROR or error.details.get("ax_error") != -25204:
            raise
        print(f"'$1' action was already unavailable: {error}")
PY
  sleep "${2:-2}"
}

set_field() {
  macos-harness <<PY
matches = mac.ax.query_all("$1", role="text field", apps="Simulator", limit=10, attributes=["AXDescription"])
exact = [item for item in matches if item.get("description") == "$1"]
if len(exact) != 1:
    raise RuntimeError(f"expected one '$1' field, found {len(exact)}")
mac.ax.set(exact[0]["element_index"], "AXValue", "$2")
PY
}

wait_for_app_exit() {
  cleanup
  waited=1
  while [ "$waited" -le 20 ]; do
    if ! xcrun simctl spawn "$device" /bin/ps -ax \
      | grep -F "/CoreSimulator/Devices/$device/data/Containers/Bundle/Application/" \
      | grep -F '/Sona.app/Sona' >/dev/null; then
      return
    fi
    waited=$((waited + 1))
    sleep 1
  done
  echo "Sona remains running in the simulator after smoke cleanup" >&2
  return 1
}

press "Start"
press "Allow" 2 optional
press "Pair this phone with your Mac"
set_field "Vault address" "$endpoint"
set_field "Vault id" "$vault_id"
press "Create a pairing code" 3
press "Copy the code"
xcrun simctl pbpaste "$device" > "$offer"
bun "$project_dir/scripts/approve-pairing.ts" "$offer" "$endpoint"
sleep 2
press "Finish pairing" 4
press "Close"
press "Start recording" 10
xcrun simctl io "$device" screenshot "$screenshot"
press "Stop recording" 8 stopping

/usr/bin/python3 -c "
import json
events = json.load(open('$events'))
committed = [e for e in events if e['kind'] == 'committed']
print(json.dumps({
    'kinds': [event['kind'] for event in events],
    'committed': [event['audio_digest_matches'] for event in committed],
}))
raise SystemExit(0 if committed and committed[-1]['audio_digest_matches'] else 1)"

wait_for_app_exit
