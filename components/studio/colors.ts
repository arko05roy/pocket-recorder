import type { CSSProperties } from 'react';
import type { Entity, EntityType } from '@/lib/types';

// Colour is information: each kind of thing has a hue, and each person their
// own, so a name looks the same in the transcript, the graph and the cards.
// Muted, print-like tones so they sit well on white.
const TYPE_HUE: Record<Exclude<EntityType, 'person'>, number> = {
  item: 36,     // ochre
  date: 205,    // steel blue
  amount: 158,  // green
  place: 14,    // brick
  org: 230,     // slate blue
};
const PERSON_HUES = [221, 340, 172, 26, 262, 196, 96, 300];

export type Palette = Map<string, number>; // person (lower-case) → hue

export function personPalette(entities: { text: string; type: EntityType }[]): Palette {
  const map: Palette = new Map();
  for (const e of entities) {
    const key = e.text.toLowerCase();
    if (e.type === 'person' && !map.has(key)) map.set(key, PERSON_HUES[map.size % PERSON_HUES.length]);
  }
  return map;
}

// Accepts entities ({text}) and graph nodes ({name}).
type Thing = { type: EntityType; text?: string; name?: string };
const hueOf = (e: Thing, palette: Palette) =>
  e.type === 'person' ? palette.get((e.text ?? e.name ?? '').toLowerCase()) ?? hashHue(e.text ?? e.name ?? '') : TYPE_HUE[e.type];

// A person not in this chat's palette still gets a stable colour.
const hashHue = (s: string) => PERSON_HUES[[...s.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PERSON_HUES.length];

export function entityColor(e: Thing, palette: Palette) {
  const h = hueOf(e, palette);
  return { solid: `hsl(${h} 55% 48%)`, soft: `hsl(${h} 70% 93%)`, ink: `hsl(${h} 60% 30%)`, glow: `hsl(${h} 70% 55% / .22)` };
}

export function chipStyle(e: Thing, palette: Palette): CSSProperties {
  const h = hueOf(e, palette);
  return { background: `hsl(${h} 75% 94%)`, color: `hsl(${h} 60% 30%)`, boxShadow: `inset 0 0 0 1px hsl(${h} 50% 80%)` };
}

export type { Entity };
