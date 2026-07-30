# DATA-CONTRACTS.md — models the board implies but the store lacks

MISSING-FRAMES.md said "design them anyway and I'll build the store from the design."
The frames are on the board; this file is the store contract read off them. Build to this.

## 1. `contact.tags` — for 3b (contact categories) and 4a (peer profile)

```ts
type ContactTag = 'vip' | 'family' | 'friend' | 'team';

interface Contact {
  // …existing fields (pin, name, verified, presence, blocked)…
  tags: ContactTag[];      // 0..n, user-assigned, ordered (first tag = row chip)
  favorite: boolean;       // star — independent of tags
}
```

Rendering rules from the board (3b):
- Sections in order: **ONLINE** (derived: presence !== offline) · **FAVORITES** (favorite) · **FAMILY** · **FRIEND** · **TEAM** — one section per tag; a contact appears in every section it qualifies for.
- **VIP is a tag chip, not a section**: gold chip on the row (`#e8c94a` fill 13%, border 45%).
- Tag chip colors: VIP `#e8c94a` · FAMILY `#f9a8d4` · FRIEND `#93c5fd` · TEAM `#c4b5fd`.
- Section header carries: icon, label, total count, `n online` (green, presence-derived); collapsible (chevron).
- Filter chips at top: All · VIP · Family · Friend · Team (single-select).
- Blocked contacts stay listed with a red `blocked` note; blocking does not clear tags.
- 4a (peer profile) shows the same tags as editable chips; edits are local to the viewer (tags are **my** labels for the contact — never synced to the peer).

Store: persist per owner — `Map<contactPin, { tags, favorite }>` alongside the existing contact record. Guests keep it in the browser-restore snapshot like the rest of their footprint.

## 2. Reactions — for 4c (message actions)

```ts
type ReactionEmoji = '❤️' | '👍' | '😂' | '😮' | '😢' | string; // quick row is these 5; '+' opens full picker

interface MessageReactions {
  // keyed by emoji, values are reactor pins, insertion-ordered
  [emoji: string]: string[];  // e.g. { '❤️': ['219-406', '842-317'], '😂': ['573-882'] }
}
```

Rules from the board (4c):
- Quick-react row above the focused bubble: ❤️ 👍 😂 😮 😢 + `+` (full emoji picker).
- **One reaction per user per message** — picking a second emoji moves the reaction; re-picking the same emoji removes it (toggle).
- Display: chips on the bubble's bottom edge — emoji + count when >1; my own reaction renders accent-tinted, others neutral glass.
- Group chats: long-press a reaction chip lists who reacted (name + role badge).
- Reactions travel E2E like messages; they are edits on the target message id, subject to the same 15-minute "remove for everyone" window shown in 4c.
- Reacting never changes thread unread state; it may fire a muted toast to the message author only.

Store: `reactions: MessageReactions` on the message record; wire format = `{ messageId, emoji, op: 'add' | 'remove' }`.
