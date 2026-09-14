# Current objective
Reduce the desktop window by another 15%, restore the user's window and panel layout exactly, and remove visible menu scrollbars without removing scrolling or clipping execution-mode descriptions.

## Completed
- Desktop defaults are now 1156x723; legacy untouched 1360x850 state migrates once while arbitrary user-resized geometry, position, and maximized state remain unchanged.
- Native save/restore continues to persist size and position on move, resize, close, and exit; desktop left/right sidebar visibility now saves synchronously, and all resizable panel widths retain Astryx local persistence IDs.
- Model, execution-mode, and sidebar action menus hide scrollbar chrome while retaining wheel/touch scrolling. The compact execution menu is viewport-capped, wraps descriptions, and blocks horizontal overflow.
- Added focused source-contract coverage for default-window migration, panel persistence, hidden menu scrollbars, and execution-menu sizing.

## Evidence and decisions
- Astryx `DropdownMenu` supports explicit/intrinsic menu widths and viewport caps; selector popup internals own their scrolling, so scrollbar styling targets those scroll containers rather than disabling overflow.
- The window migration matches only the exact legacy default dimensions, avoiding changes to manually chosen sizes and positions.

## Remaining
- Push the verified change and confirm GitHub workflow success.

## Touched files
- Desktop Tauri window configs and native state migration; chat layout/menu components and shared CSS; focused Node regression tests.

## Verification
- All 1,206 non-Cargo tests pass; `pnpm check` and `pnpm native:check` pass.
- `pnpm lint` passes across all 553 checked source files.
- GitHub CI pending.
