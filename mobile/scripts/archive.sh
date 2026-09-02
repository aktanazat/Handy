#!/bin/sh
# Archive Sona for iOS and export a signed .ipa. Does not upload.
#
# Automatic signing with -allowProvisioningUpdates, so a Mac signed in to the team
# creates or repairs the profiles for the app and its watch app on the way through.
#
# Usage: mobile/scripts/archive.sh [output-directory]
set -eu

project_dir=$(cd "$(dirname "$0")/.." && pwd)
output=${1:-$project_dir/build}
archive=$output/Sona.xcarchive

mkdir -p "$output"
xcodebuild -project "$project_dir/Sona.xcodeproj" \
  -scheme Sona \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=AAVB324H37 \
  CODE_SIGN_STYLE=Automatic \
  archive

xcodebuild -exportArchive \
  -archivePath "$archive" \
  -exportPath "$output" \
  -exportOptionsPlist "$project_dir/ExportOptions.plist" \
  -allowProvisioningUpdates

echo "exported:"
ls "$output"/*.ipa
