# RELAY v2.0 — Product Design & UI Specification
*Target Release: v2.0.0 (Phone-App Metaphor)*

---

## A. Brand & Mood
RELAY v2.0 is a high-fidelity, premium communication tool designed to feel like a native, secure mobile operating system running directly inside the browser. The mood is confident, calm, and tactical. It avoids unnecessary decorative elements in favor of high-contrast typography, generous interactive hit targets, and smooth, fluid micro-interactions. The dark-theme-first aesthetic uses deep space-slates paired with a vibrant, high-energy cyan accent to guide the eye to primary communication actions, creating an atmosphere of immediate utility, absolute privacy, and modern performance.

---

## B. Color Tokens (OKLCH)

### 1. Dark Theme (Default)
```css
--background:           oklch(0.12 0.01 220);          /* Deep Space Slate */
--surface:              oklch(0.16 0.01 220);          /* Muted Card/Shell Background */
--surface-elevated:     oklch(0.22 0.01 220);          /* Popovers, Modals, Hover States */
--foreground:           oklch(0.95 0.005 220);         /* High-Contrast Bone White */
--foreground-muted:     oklch(0.65 0.01 220);          /* Secondary Labels & Timestamps */

--accent:               oklch(0.85 0.18 195);          /* Electric Cyan (Primary Action) */
--accent-foreground:    oklch(0.12 0.04 195);          /* Deep Slate for high-contrast text on Cyan */

--success:              oklch(0.78 0.16 140);          /* Emerald Green (Online / Call Button) */
--success-foreground:   oklch(0.10 0.04 140);          /* Deep Green for text on Emerald */
--warning:              oklch(0.82 0.15 75);           /* Amber Yellow (Away / Idle) */
--danger:               oklch(0.62 0.18 25);           /* Crimson Red (Decline / Missed Call) */

--chat-bubble-mine-bg:  oklch(0.20 0.04 195);          /* Subtle Cyan-Tinted Slate */
--chat-bubble-mine-fg:  oklch(0.92 0.02 195);          /* Crisp Light Cyan-White */
--chat-bubble-theirs-bg:oklch(0.18 0.01 220);          /* Surface Slate */
--chat-bubble-theirs-fg:oklch(0.95 0.005 220);         /* Pure Foreground */

--divider:              oklch(0.20 0.01 220);          /* Hairline Borders */
--ring:                 oklch(0.85 0.18 195);          /* Focus Ring (Cyan) */
```

### 2. Light Theme Variant
```css
--background:           oklch(0.98 0.003 220);         /* Soft Cool White */
--surface:              oklch(0.94 0.005 220);         /* Light Gray Panel */
--surface-elevated:     oklch(0.88 0.008 220);         /* Active/Hover Light Gray */
--foreground:           oklch(0.15 0.01 220);          /* Deep Charcoal */
--foreground-muted:     oklch(0.45 0.01 220);          /* Slate Gray Secondary */

--accent:               oklch(0.62 0.16 195);          /* Deep Cyan (High-Contrast Primary) */
--accent-foreground:    oklch(0.98 0.01 195);          /* White on Deep Cyan */

--success:              oklch(0.55 0.15 140);          /* Rich Forest Green */
--success-foreground:   oklch(0.98 0.01 140);          /* White on Green */
--warning:              oklch(0.65 0.14 75);           /* Dark Amber */
--danger:               oklch(0.55 0.18 25);           /* Dark Crimson */

--chat-bubble-mine-bg:  oklch(0.88 0.08 195);          /* Soft Light Cyan Tint */
--chat-bubble-mine-fg:  oklch(0.15 0.05 195);          /* Deep Cyan-Slate Text */
--chat-bubble-theirs-bg:oklch(0.92 0.005 220);         /* Soft Gray Bubble */
--chat-bubble-theirs-fg:oklch(0.15 0.01 220);          /* Deep Charcoal Text */

--divider:              oklch(0.88 0.005 220);         /* Soft Hairline Borders */
--ring:                 oklch(0.62 0.16 195);          /* Focus Ring (Deep Cyan) */
```

---

## C. Typography

RELAY v2.0 loads two Google Fonts:
1. **Inter** (Weights: `400`, `500`, `600`, `700`) — for all UI labels, body text, and interfaces.
2. **JetBrains Mono** (Weights: `500`, `700`, `800`) — for numbers, dialing inputs, and system codes.

### Typography Hierarchy

| Style Name | Font Family | Size | Weight | Line Height | Tracking |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `app-title` | Inter | `1.125rem` (18px) | 600 | 1.25 | `-0.01em` |
| `my-number-display`| JetBrains Mono | `1.5rem` (24px) | 700 | 1.0 | `0.05em` |
| `dialer-input` | JetBrains Mono | `2.25rem` (36px) | 800 | 1.0 | `0.1em` |
| `key-label` | Inter | `1.5rem` (24px) | 500 | 1.0 | `normal` |
| `key-sublabel` | Inter | `0.5625rem` (9px) | 500 | 1.0 | `0.1em` |
| `message-body` | Inter | `0.9375rem` (15px) | 400 | 1.45 | `-0.005em` |
| `message-meta` | Inter | `0.6875rem` (11px) | 400 | 1.2 | `0.01em` |
| `list-name` | Inter | `1.0rem` (16px) | 600 | 1.3 | `-0.01em` |
| `list-preview` | Inter | `0.875rem` (14px) | 400 | 1.35 | `normal` |

---

## D. Spacing & Radii

### 1. Spacing System
All layout spacing relies on a strict `4px` base unit system:
- `space-1` = `4px`
- `space-2` = `8px`
- `space-3` = `12px`
- `space-4` = `16px`
- `space-5` = `20px`
- `space-6` = `24px`
- `space-8` = `32px`
- `space-12` = `48px`

### 2. Component Layout Paddings
- **List Items (Threads, Contacts, History):** `12px` vertical, `16px` horizontal.
- **App Shell Outer Margins:** Mobile: `16px`, Tablet/Desktop: `24px`.
- **Chat Input Composer Area:** `12px` padding on container, `8px 12px` inside text area.

### 3. Corner Radii
- **Keypad Buttons:** Perfect circles (`border-radius: 9999px`).
- **Chat Bubbles:**
  - **Mine:** `16px` (`lg`) on top-left, top-right, bottom-left; `4px` on bottom-right (squared off).
  - **Theirs:** `16px` (`lg`) on top-left, top-right, bottom-right; `4px` on bottom-left (squared off).
- **Cards (Contacts, Call History):** `12px` (`md`).
- **Modals / Call Sheets:**
  - **Desktop Modals:** `20px` (`xl`) uniform.
  - **Mobile Bottom Sheets:** `24px` (`2xl`) on top-left and top-right; `0px` on bottom corners.

---

## E. Elevation & Shadows

Elevation states use smooth, layered, low-saturation shadows to prevent a muddy look in dark themes.

### Level 1: Low Elevation (Cards, Inset Panels)
```css
box-shadow: 
  0 2px 8px -1px oklch(0.05 0.01 220 / 0.15),
  0 1px 3px -1px oklch(0.05 0.01 220 / 0.10);
```

### Level 2: Mid Elevation (Dropdowns, Popovers, Sidebars)
```css
box-shadow: 
  0 12px 24px -4px oklch(0.05 0.01 220 / 0.30),
  0 4px 12px -2px oklch(0.05 0.01 220 / 0.15);
```

### Level 3: High Elevation (Modals, Call Peek Sheets)
```css
box-shadow: 
  0 24px 48px -8px oklch(0.05 0.01 220 / 0.50),
  0 8px 20px -4px oklch(0.05 0.01 220 / 0.25);
```

---

## F. App Shell

### 1. Dimension Specifications
- **Mobile Header Height:** `56px`
- **Mobile Bottom Navigation Height:** `64px`
- **Desktop Sidebar Width:** `280px`
- **Desktop Header:** Integrated inline within the content pane.

### 2. Tab Navigation & Indicators
- **Unread/Missed Badges:** High-contrast `bg-danger` (Red) circles containing white text, positioned at the top-right corner of tab icons.
- **Active Tab State:**
  - **Mobile Bottom Nav:** The active tab icon and label animate to `var(--accent)` (Cyan). A subtle horizontal pill indicator (`24px` width, `3px` height) sits centered directly above the active icon at the top of the bottom bar.
  - **Desktop Sidebar:** Active row uses a soft background fill (`var(--surface-elevated)`) with a vertical accent bar (`3px` width, `20px` height) centered on the left edge of the menu item.

### 3. Layout Wireframes

#### Mobile Layout Shell (< 768px)
```
+-------------------------------------------------+
| [RELAY]                                (562-981) | <-- Header (56px)
+-------------------------------------------------+
|                                                 |
|                                                 |
|                                                 |
|                 ACTIVE CONTENT                  |
|                     SPACE                       |
|                                                 |
|                                                 |
|                                                 |
+-------------------------------------------------+
|    [  #  ]            [ (3) ]            [  O  ] | <-- Bottom Nav (64px)
|    Dialer            Messages           Profile |
+-------------------------------------------------+
```

#### Desktop Layout Shell (>= 768px)
```
+------------------+--------------------------------------------------------+
| [RELAY]          |  DIALER                                      (562-981)  |
|                  +--------------------------------------------------------|
|  #  Dialer       |                                                        |
|                  |                     ACTIVE CONTENT                     |
| (3) Messages     |                         SPACE                          |
|                  |                                                        |
|  8  Contacts     |                                                        |
|                  |                                                        |
|  O  Profile      |                                                        |
|                  |                                                        |
|                  |                                                        |
+------------------+--------------------------------------------------------+
^ Sidebar (280px)  ^ Main Pane (Flexible)
```

---

## G. Dialer

### 1. Keypad Layout Grid
The dialer keypad is a strict 3-column, 4-row layout centered horizontally inside the viewport. It dynamically scales to fit any screen size without causing layout overflow.

```css
.dialer-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  width: 100%;
  max-width: calc((clamp(56px, 18vw, 88px) * 3) + (clamp(6px, 1.5vw, 14px) * 2));
  gap: clamp(6px, 1.5vw, 14px);
  margin: 0 auto;
}
```

### 2. Keypad Button Styling
Each keypad button must maintain a strict `1:1` aspect ratio (perfect circle).

- **Default State:**
  - Background: `var(--surface)`
  - Typography: `var(--foreground)`
  - Border: `1px solid var(--divider)`
  - Transition: `background-color 150ms ease, transform 100ms ease`
- **Pressed State (Active):**
  - Background: `var(--surface-elevated)`
  - Scale: `transform: scale(0.96)`
- **Focus Ring:**
  - `outline: none; ring-2 ring-ring ring-offset-2 ring-offset-background`

```
  +-------------+
  |      1      |  <-- key-label (JetBrains Mono, 24px)
  |    _ _ _    |  <-- key-sublabel (Inter, 9px, muted)
  +-------------+
```

### 3. Call Button Configurations
The primary "Call" button changes layout depending on the device viewport:

- **Mobile (< 768px):** Full-width pill button spanning the bottom of the dialer panel.
  - Height: `56px`
  - Radius: `16px`
  - Background: `var(--success)`
  - Text: `var(--success-foreground)`
- **Desktop (>= 768px):** Circular button centered directly below the keypad.
  - Dimensions: `72px` x `72px`
  - Radius: `9999px`
  - Background: `var(--success)`
  - Icon: Call icon (centered, `28px` size)

---

## H. Messages

### 1. Message Bubbles
- **Max Width:** `75%` of the chat container width.
- **My Bubbles:**
  - Background: Subtle gradient from `oklch(0.20 0.04 195)` to `oklch(0.16 0.03 195)`.
  - Border: `1px solid oklch(0.85 0.18 195 / 0.15)`.
  - Text: `var(--chat-bubble-mine-fg)`.
- **Their Bubbles:**
  - Background: `var(--chat-bubble-theirs-bg)`.
  - Border: `1px solid var(--divider)`.
  - Text: `var(--chat-bubble-theirs-fg)`.
- **Status Indicators:**
  - **Delivered:** Single check icon (`oklch(0.65 0.01 220)`).
  - **Read:** Double check icon (`oklch