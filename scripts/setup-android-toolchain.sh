#!/usr/bin/env bash
# Android SDK setup — برای هر سشن تازه (SDK بین سشن‌ها پاک می‌شود)
set -e
export ANDROID_HOME=/home/z/my-project/android-sdk
mkdir -p "$ANDROID_HOME"
CD=$ANDROID_HOME/cmdline-tools
if [ ! -x "$CD/latest/bin/sdkmanager" ]; then
  rm -rf /tmp/clt "$CD"
  mkdir -p /tmp/clt "$CD"
  curl -sSL -o /tmp/clt.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  cd /tmp/clt && unzip -q /tmp/clt.zip && mv cmdline-tools "$CD/latest"
fi
SM=$CD/latest/bin/sdkmanager
yes | $SM --licenses > /tmp/lic.log 2>&1 || true
$SM --install "platform-tools" "platforms;android-35" "build-tools;35.0.0" > /tmp/sdk.log 2>&1
ls "$ANDROID_HOME/platforms" "$ANDROID_HOME/build-tools"
echo "== SDK READY =="
