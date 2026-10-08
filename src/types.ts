export interface Region { x: number; y: number; width: number; height: number }
export interface ScorePage { id: string; image: string; width: number; height: number }
export interface Anchor { time: number; progress: number }
export interface KaraokeFlag { id: string; time: number; segmentId: string; kind: 'start' | 'transition' | 'end' }
export interface Segment { id: string; pageId: string; region: Region; startTime: number; endTime: number; direction: 'left-to-right'; text?: string; anchors?: Anchor[]; cuts?: number[] }
export interface AutoCandidate { pageId: string; region: Region; text: string; startTime: number; endTime: number; confidence: number; matchedText: string; source: string }
export interface AutoBoxCandidate { pageId: string; region: Region; sourceText: string; row: number; part: number }
export interface ExportSettings { preset: 'landscape' | 'portrait' | 'social' | 'square' | 'custom'; width: number; height: number; fps: number; scoreZoom: number }
export interface Project { version: 1; projectName: string; projectId?: string | null; source: { pdf: string | null; audio: string | null; audioUrl?: string | null }; pages: ScorePage[]; segments: Segment[]; flags?: KaraokeFlag[]; audioDuration?: number | null; export?: ExportSettings; highlight: { opacity: number } }

export const initialProject: Project = { version: 1, projectName: '未命名歌曲', source: { pdf: null, audio: null }, pages: [], segments: [], flags: [], highlight: { opacity: 0.32 }, export: { preset: 'landscape', width: 1920, height: 1080, fps: 30, scoreZoom: 1 } }
