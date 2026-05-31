---
name: Radical Monolith
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1b1b1b'
  on-surface-variant: '#4c4546'
  inverse-surface: '#303030'
  inverse-on-surface: '#f1f1f1'
  outline: '#7e7576'
  outline-variant: '#cfc4c5'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1b'
  on-primary-container: '#848484'
  inverse-primary: '#c6c6c6'
  secondary: '#5d5f5f'
  on-secondary: '#ffffff'
  secondary-container: '#dfe0e0'
  on-secondary-container: '#616363'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1a1c1d'
  on-tertiary-container: '#838486'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c7'
  on-secondary-fixed: '#1a1c1c'
  on-secondary-fixed-variant: '#454747'
  tertiary-fixed: '#e2e2e4'
  tertiary-fixed-dim: '#c6c6c8'
  on-tertiary-fixed: '#1a1c1d'
  on-tertiary-fixed-variant: '#454749'
  background: '#f9f9f9'
  on-background: '#1b1b1b'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: -0.04em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  touch-target-min: 48px
  margin-edge: 20px
  gutter: 12px
  stack-overlap: -16px
---

## Brand & Style

This design system is built on the philosophy of **Radical Minimalism**. It targets users who require a high-utility, distraction-free interface for offline-first mobile payments. The emotional response is one of absolute clarity, reliability, and precision—mirroring the weight and tangibility of a physical leather wallet.

The aesthetic blends stark, high-contrast layouts with subtle skeuomorphic metaphors. It utilizes deep blacks to represent the "container" (the wallet) and pure whites for the "content" (the currency and receipts). Visual metaphors are key: transaction records should feel like physical paper emerging from a printer, and the navigation should act as a tactile floating pill that feels anchored to the thumb zone.

## Colors

The palette is strictly functional, leveraging extreme contrast to ensure legibility in high-glare outdoor environments.

- **Primary (#000000):** Used for structural containers, primary action buttons, and critical text.
- **Secondary (#FFFFFF):** The base for "surface" elements like receipts and cards.
- **Neutral (#F5F5F7):** A soft off-white used for the global background to prevent eye strain and separate the white component surfaces from the app frame.
- **Amber (#FFB020):** Dedicated exclusively to "Pending" or "In-Progress" states.
- **Emerald (#10B981):** Reserved for "Settled" or "Success" states. 

Avoid using gradients or decorative tints; color must only be used to convey state or primary hierarchy.

## Typography

The system utilizes **Inter** for its neutral, highly legible sans-serif qualities, ensuring readability across all weights. To emphasize the "data-focused" nature of payments, **JetBrains Mono** (or a similar high-quality monospace font) is introduced for transaction IDs, amounts, and receipt data.

Hierarchy is strict:
- **Large Display:** Reserved for wallet balances only.
- **Monospace Data:** Used for all currency values and timestamps to ensure character alignment in lists.
- **Upper-case Labels:** Used for small metadata to differentiate from body text without increasing font size.

## Layout & Spacing

This is a mobile-first system designed for **one-handed operation**. All primary interactive elements are concentrated in the bottom 40% of the screen (the Ergonomic Thumb-Zone).

- **Grid:** A 4-column fluid mobile grid with 20px side margins.
- **Touch Targets:** A mandatory 48x48dp minimum for every interactive element.
- **Visual Stacking:** Use negative spacing (`stack-overlap`) for the "wallet card" metaphor, where cards appear to be tucked behind one another.
- **Safe Zones:** Ensure the floating navigation pill maintains a 16px clearance from the bottom edge of the screen.

## Elevation & Depth

Depth is achieved through **Physical Layering** rather than traditional soft shadows.

1.  **Level 0 (Background):** The `#F5F5F7` canvas.
2.  **Level 1 (The Wallet):** A black, textured or matte surface container that holds the cards.
3.  **Level 2 (The Cards/Receipts):** White surfaces that sit "inside" or "on top of" the Level 1 container.
4.  **Floating Elements:** The navigation pill uses a high-contrast black fill with a very subtle 10% opacity black shadow (0px 4px 12px) to suggest it is floating significantly above the content.

For the receipt metaphor, use a hard-edged "zig-zag" cut effect at the bottom of the white container to simulate torn paper.

## Shapes

The shape language is "Squircle-heavy" for containers but sharp for data elements.

- **Primary Containers:** 1rem (16px) radius for wallet cards and main app modules to feel friendly and modern.
- **Action Elements:** The floating nav pill and primary buttons use a full pill-shape (radius: 100px) to maximize the "tactile" feel.
- **Data Elements:** Smaller tags and chips use a tighter 0.25rem (4px) radius to maintain a professional, systematic look.

## Components

### Floating Nav Pill
A centered, black container holding 48x48dp icon targets. The active state is shown by a white icon; inactive states are at 40% opacity white.

### Skeuomorphic Receipt
A white container with a 1px inner border (`#EEEEEE`). The top edge should feature a "slot" metaphor (a dark recessed bar) from which the receipt appears to emerge. The bottom edge uses a decorative serrated "tear" path.

### Wallet Card Stack
A vertical stack of cards where only the top 64px of the background cards are visible. Tapping a card "pulls" it to the front using a spring animation.

### Primary Button
Solid `#000000` fill with white Inter-Bold text. Full width on mobile, 56px height.

### Status Chips
Minimalist indicators using a small 8px solid dot of the status color (Amber or Emerald) next to Monospace text. No background fill for chips to keep the UI "Radical" and clean.

### Input Fields
Underlined only (no bounding box) to maintain minimalism, using a 2px black stroke for the active state and 1px `#DDDDDD` for inactive.