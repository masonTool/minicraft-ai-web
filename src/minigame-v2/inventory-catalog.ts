import { categoryOf } from '../core/registry/items.ts';

export type V2CreativeCategory = 'all' | 'building' | 'equipment' | 'items' | 'nature';

export const CREATIVE_CATEGORIES: ReadonlyArray<{ key: V2CreativeCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'building', label: '建筑' },
  { key: 'equipment', label: '装备' },
  { key: 'items', label: '物品' },
  { key: 'nature', label: '自然' },
];

export function creativeTabFor(id: number): Exclude<V2CreativeCategory, 'all'> {
  switch (categoryOf(id)) {
    case 'building':
      return 'building';
    case 'tools':
    case 'armor':
      return 'equipment';
    case 'natural':
    case 'wool':
    case 'food':
      return 'nature';
    default:
      return 'items';
  }
}
