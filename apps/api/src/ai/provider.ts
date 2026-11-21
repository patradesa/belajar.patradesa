/**
 * Adapter AI terpisah. Phase 0/1 TIDAK memakai AI: DisabledAiProvider dipakai di produksi.
 * Phase 2 akan menambah WorkersAiProvider yang memenuhi interface ini (lihat ADR-0005).
 */
export interface AiRequest {
  purpose: 'chat' | 'summary' | 'explain' | 'hint' | 'recommend';
  userId: string;
  lessonId: string | null;
  message: string;
  /** Konteks HANYA dari lesson_sources yang disetujui admin. */
  sources: { sectionKey: string; text: string }[];
}

export interface AiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
}

export interface AiProvider {
  readonly enabled: boolean;
  generate(req: AiRequest): Promise<AiResponse>;
}

export class DisabledAiProvider implements AiProvider {
  readonly enabled = false;
  generate(): Promise<AiResponse> {
    return Promise.reject(new Error('AI provider disabled in Phase 1'));
  }
}
