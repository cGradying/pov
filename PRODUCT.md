# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Node.js, zero npm dependencies (built-in `http`), vanilla HTML/CSS/JS frontend, JSON file store. Runs locally with `node server.js`. Uses `yt-dlp` (metadata only) and `ffmpeg`/`ffprobe` (local thumbnails) when present.

## Users
The student (owner) running it on their own Mac for a COMP 001 class assignment; classmates and instructor viewing it during a demo.

## Product Purpose
"pov" (Pick. Open. View.) — a personal viewing shelf. Collects YouTube videos (linked by URL, never downloaded) and videos already sitting on the owner's computer into YouTube-style shelves, and plays either in place. Success: paste a link, see a proper card (thumbnail, duration, title, channel, views, age) appear; local clips show up without copying anything.

## Positioning
One shelf for both the internet and your own hard drive, curated as your point of view.

## Capabilities and Constraints
- YouTube: single videos and playlists via URL; metadata only, playback through the official embed.
- Local: scans folders listed in `config.json`, streams files in place, generic thumbnail when ffmpeg cannot read one.
- Localhost only (127.0.0.1). No accounts, no uploads.
- Starts empty with a guided state (user decision).

## Brand Commitments
Name: "pov", short for "Pick. Open. View." Fonts: Clash Display (display), Satoshi (UI), Boska italic (accents), Reenie Beanie (scribbles). Layout reference: `Goals/` (YouTube shelf row). Visual references: `References/` with the green palette `#1F4B2C #4D7111 #C3E956 #B2FEE7 #F4FFFC` binding (user: "strictly for green ones").

## Evidence on Hand
No seed content. Do not invent views, channels, or testimonials.

## Product Principles
1. Never download from YouTube; link and embed.
2. Never copy or move the owner's files.
3. Simple enough for a first-year student to read and explain.
