/** Los tipos del protocolo bot ↔ panel del bot (mutbot) que todavía nombra el núcleo. En la extensión no hay panel del bot: son solo tipos. */
export type NoteKind = 'spot' | 'travel' | 'flee' | 'stat' | 'loot' | 'order' | 'stuck' | 'death' | 'fight' | 'system';
export type ChatChannel = 'normal' | 'party' | 'guild';
export type ChatEntry = { at: number; kind: ChatChannel | 'whisper' | 'server'; from: string; text: string; mine?: boolean };
export type PanelCommand =
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'town' }
  | { cmd: 'drop'; slot: number }
  | { cmd: 'say'; text: string; to?: string; channel?: ChatChannel };
