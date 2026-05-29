<!-- Thanks for the contribution. Please fill in the sections below — they help keep
the project in shape, and they help Claude (or any LLM agent) reason about future
changes accurately. -->

## What changed

<!-- One or two sentences. What does this PR do, from the user's perspective? -->

## Why

<!-- The motivation. Bug, feature request, design decision, etc. -->

## How it works

<!-- For non-trivial changes: which files were touched, which APIs/components, what
the data flow looks like. Keep this brief but specific. -->

## Verification

- [ ] `pnpm check` passes locally
- [ ] `pnpm test` passes locally (17 baseline tests + any new ones)
- [ ] Manually verified in the dev preview (if UI-affecting)
- [ ] Verified on a real device for camera/WebRTC/filter changes (if applicable)

## Documentation hygiene

- [ ] Updated `todo.md` (added new items as `[ ]`, marked finished items as `[x]`, never deleted)
- [ ] Updated `CLAUDE.md` if architecture, decisions, conventions, or pending work changed
- [ ] Bumped the version footer in `client/src/pages/Relay.tsx` if this is a user-visible change

## Notes for reviewers

<!-- Anything subtle worth flagging — perf considerations, breaking changes for users on
older clients, secrets that need to be added in Manus settings, etc. -->
