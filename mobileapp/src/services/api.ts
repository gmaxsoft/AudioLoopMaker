import { API_BASE_URL } from '../constants';

export type UploadResult = {
  filename: string;
  originalName: string;
  size: number;
  url: string;
  duration: number;
  sampleRate: number;
  channels: number;
  suggestedStart: number;
  suggestedEnd: number;
  suggestedCrossfade: number;
  suggestionNote?: string;
  longestSuggestedStart?: number;
  longestSuggestedEnd?: number;
  longestSuggestionNote?: string;
};

export type GenerateParams = {
  filename: string;
  start: number;
  end: number;
  crossfadeMs: number;
  format: 'ogg' | 'wav';
  repeats: number;
  normalize: boolean;
  pingPong: boolean;
};

export type GenerateResult = {
  success: boolean;
  downloadUrl: string;
  filename: string;
  duration: number;
  format: string;
  sampleRate: number;
  crossfadeMs: number;
  repeats: number;
  normalize: boolean;
  pingPong?: boolean;
};

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data;
}

export async function uploadAudio(uri: string, name: string, mime: string): Promise<UploadResult> {
  const form = new FormData();
  form.append('audio', {
    uri,
    name,
    type: mime || 'audio/mpeg',
  } as unknown as Blob);

  const res = await fetch(`${API_BASE_URL}/api/upload`, {
    method: 'POST',
    body: form,
    headers: {
      Accept: 'application/json',
    },
  });
  return (await parseJson(res)) as UploadResult;
}

export async function suggestLoop(
  filename: string,
  mode: 'best' | 'longest' = 'best'
): Promise<{
  suggestedStart: number;
  suggestedEnd: number;
  suggestionNote?: string;
  best?: { suggestedStart: number; suggestedEnd: number; suggestionNote?: string };
  longest?: { suggestedStart: number; suggestedEnd: number; suggestionNote?: string };
}> {
  const res = await fetch(
    `${API_BASE_URL}/api/suggest/${encodeURIComponent(filename)}?mode=${mode}`
  );
  return parseJson(res);
}

export async function refineSeam(
  filename: string,
  start: number,
  end: number
): Promise<{
  suggestedStart: number;
  suggestedEnd: number;
  seamScore?: number;
  seamLabel?: string;
  suggestionNote?: string;
}> {
  const res = await fetch(`${API_BASE_URL}/api/refine-seam`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, start, end, searchMs: 45 }),
  });
  return parseJson(res);
}

export async function generateLoop(params: GenerateParams): Promise<GenerateResult> {
  const res = await fetch(`${API_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await parseJson(res)) as GenerateResult;
}

export function absoluteMediaUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}
