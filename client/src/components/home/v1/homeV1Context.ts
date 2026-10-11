import { createContext, useContext } from 'react'
import type { HomeFeedItem } from '@/types/homeFeed'
import type { EngageTarget } from '@/lib/homeEngagement'
import type { Profile } from '@/components/community/PeopleListView'

/**
 * What every Home v1 card needs from the feed: write-through to the feed
 * cache, the one comments sheet, and the one Community deck — mounted once by
 * HomeV1Feed instead of once per card.
 */
export interface CommentsRequest {
  target: EngageTarget
  feedItemId: string
  /** The item's author: may delete any comment and turn comments off (H17). */
  ownerId: string | null
  count: number
  enabled: boolean
}

export interface HomeV1ContextValue {
  patchItem: (feedItemId: string, patch: Partial<HomeFeedItem>) => void
  removeItem: (feedItemId: string) => void
  openComments: (req: CommentsRequest) => void
  openDeck: (members: Profile[], startIndex: number, contextLabel: string) => void
  /** Light rows (id/name/avatar) → fetch full profiles, then open the deck. */
  openDeckByIds: (ids: string[], startIndex: number, contextLabel: string) => void
}

const noop = () => {}
export const HomeV1Context = createContext<HomeV1ContextValue>({
  patchItem: noop,
  removeItem: noop,
  openComments: noop,
  openDeck: noop,
  openDeckByIds: noop,
})

export const useHomeV1 = () => useContext(HomeV1Context)
