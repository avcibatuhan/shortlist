export type SettingsSlug = 'profile' | 'searches' | 'filters' | 'budget' | 'model' | 'apify'

export const SETTINGS_SECTIONS: { slug: SettingsSlug; label: string; hint: string }[] = [
  { slug: 'profile', label: 'Profile', hint: 'What the LLM knows about you' },
  { slug: 'searches', label: 'Searches', hint: 'Sources, keywords, limits' },
  { slug: 'filters', label: 'Filters', hint: 'Exclude terms in titles' },
  { slug: 'budget', label: 'Budget & prices', hint: 'Monthly cap, Actor prices' },
  { slug: 'model', label: 'Model & Ollama', hint: 'Local LLM, connection test' },
  { slug: 'apify', label: 'Apify token', hint: 'Kept in .env only' },
]
