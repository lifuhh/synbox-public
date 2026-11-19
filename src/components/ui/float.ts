// The one surface everything floating over the page shares (DESIGN.md §5): menus, popovers, dialogs, sheets, toasts
// and the top bar's search results. Its radius and its shadow, which is also its only edge, are tokens in
// src/globals.css (--radius-float, --shadow-float). The transparent border is what forced-colors mode draws once it
// drops the shadow
export const FLOAT_SURFACE =
  'rounded-float border border-transparent bg-popover text-popover-foreground shadow-float'

// A section's label inside a floating panel (the Notifications panel's Admin, Lyrics Fixed, Feedback Resolved): Title
// Case words at a readable size, never small tracked capitals (DESIGN.md §1)
export const FLOAT_SECTION_LABEL = 'text-sm font-medium text-muted-foreground'

// A dialog or sheet: in over 200ms, out over 120ms, on the UI ease (DESIGN.md §7). Its own variant says how it moves
export const DIALOG_MOTION =
  'ease-ui data-[state=closed]:animate-out data-[state=closed]:duration-(--duration-menu-out) data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:duration-(--duration-menu-in) data-[state=open]:fade-in-0'

// A menu or popover opening: 200ms, fading in and dropping 6px from its trigger (only fading under Reduce Motion);
// closing: 120ms, fading out. Both on the UI ease (DESIGN.md §7). No zoom: scaling a large card moves its far edge
// tens of pixels
export const FLOAT_MOTION =
  'ease-ui data-[state=closed]:animate-out data-[state=closed]:duration-(--duration-menu-out) data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:duration-(--duration-menu-in) data-[state=open]:fade-in-0 motion-safe:data-[side=bottom]:slide-in-from-top-[6px] motion-safe:data-[side=left]:slide-in-from-right-[6px] motion-safe:data-[side=right]:slide-in-from-left-[6px] motion-safe:data-[side=top]:slide-in-from-bottom-[6px]'
