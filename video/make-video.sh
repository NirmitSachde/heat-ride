#!/bin/sh
# Build video/street-skin-60s.mp4 from video/raw.mp4 (scripts/record-video.mjs) and the voiceover.
# Usage: video/make-video.sh [seconds_to_skip_at_start]
set -e
cd "$(dirname "$0")"
SKIP=${1:-1.5}
say -v Daniel -r 165 -f voiceover.txt -o voice.aiff
ffmpeg -y -loglevel error -ss "$SKIP" -i raw.mp4 -i voice.aiff \
  -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=10[v];[1:a]adelay=800|800,apad[a]" -map "[v]" -map "[a]" \
  -t 60 -r 30 -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k \
  -movflags +faststart street-skin-60s.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 street-skin-60s.mp4
