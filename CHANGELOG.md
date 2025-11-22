# Changelog

Versioning
- We follow Semantic Versioning (SemVer): MAJOR.MINOR.PATCH.
- While the project is pre-1.0, version numbers will use 0.MINOR.PATCH. Breaking changes are expected during 0.x, so increment the MINOR (0.Y.0) for changes that alter public behavior.
- Tag releases in git (e.g. `v0.1.0`) and move the Unreleased notes under the released version with the release date.

All notable changes to PlaylistGrab are documented in this file.

## [Unreleased] - 2025-11-22 — Next: 0.1.0

### Added
- Robust playlist extraction using ytInitialData JSON sniffing + recursive traversal and multiple regex fallbacks.
- Continuation / pagination fetcher that tries common continuation URL forms and respects a user-configurable "Max pages" value (default: 25).
- Multiple public CORS proxy fallbacks plus a final direct-fetch attempt as a last-resort; per-request timeouts applied.
- Progress UI with determinate/indeterminate states, inline spinner, and a Cancel button (AbortController) to stop long runs.
- Auto-showable Details/log area during extraction; downloadable sanitized log for debugging.
- Export options: TXT, CSV (includes position, videoId, title, duration, available, url), and JSON.
- Mobile-friendly paste behavior (auto-start on paste) and small UX polish (theme toggle, clear input, copy button).

### Changed
- Default max-pages raised to 25 to balance completeness vs request volume.
- Privacy and Terms pages rewritten in plain language (see `privacy.html` and `tos.html`).

### Notes
- Please test with a variety of public playlists (small, large, playlists containing private/removed items, and shared/mobile links) and report parsing edge cases.
- Update this changelog before commits/releases. If you'd like automation, I can add a pre-commit hook to prompt for changelog updates.

---

(End of initial entry)
