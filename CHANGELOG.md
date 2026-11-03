# Change Log

All notable changes to the "pdp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- The graph moved from a separate editor panel into a **Graph view** in the
  PDP sidebar (below Tasks), drawn top-to-bottom to fit the narrow view.
- New **PDP: Run To Here** task command (`pdp run --to`): runs a task and
  everything upstream of it, which works even when upstream tasks are stale
  (where **Run Only This Task** refuses).
- Right-clicking a task in the Tasks view now has a labelled **Clean Task**
  entry in addition to the inline trash icon.
