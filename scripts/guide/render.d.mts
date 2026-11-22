import type { Guide } from '../../apps/web/src/guide/content';

export function renderGuideHtml(opts: {
  guide: Guide;
  contact: Record<string, string>;
  version: string;
  appUrl: string;
  imgDir: string;
}): string;
export function headerFooter(opts: { guide: Guide; contact: Record<string, string> }): { headerTemplate: string; footerTemplate: string };
export function assets(): { logo: string; font700: string; font800: string };
