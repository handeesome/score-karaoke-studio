export interface Region { x: number; y: number; width: number; height: number }
export interface ScorePage { id: string; image: string; width: number; height: number; inverted?: boolean }
export interface KaraokeFlag { id: string; time: number; segmentId: string; kind: 'start' | 'transition' | 'end' }
export interface SegmentRegion { pageId: string; region: Region }
export interface TimingRange { startTime: number; endTime: number }
export interface Segment { id: string; pageId: string; region: Region; regions?: SegmentRegion[]; startTime: number; endTime: number; timingSet?: boolean; direction: 'left-to-right'; text?: string; partitionKey?: string }
export interface PartitionGuide { id: string; position: number }
export interface PartitionCut extends PartitionGuide { top: string; bottom: string; left: string; right: string }
export interface LyricOrder { verseCount: number; rows: Record<string, number> }
export interface PagePartition { pageId: string; horizontal: PartitionGuide[]; vertical: PartitionGuide[]; cuts: PartitionCut[]; excluded: string[]; lyricOrder?: LyricOrder; numberedKeys?: string[]; numberingSlots?: TimingRange[]; numberingEnd?: boolean }
export interface AutoCandidate { pageId: string; region: Region; segmentId?: string; text: string; startTime: number; endTime: number; confidence: number; matchedText: string; source: string }
export interface AutoBoxCandidate { pageId: string; region: Region; sourceText: string; row: number; part: number }
export interface ExportSettings { preset: 'landscape' | 'portrait' | 'social' | 'square' | 'custom'; width: number; height: number; fps: number; scoreZoom: number }
export interface Project { version: 1; partitions?: PagePartition[]; spareTimings?: TimingRange[]; projectName: string; projectId?: string | null; scoreTimingBound?: boolean; source: { pdf: string | null; audio: string | null; audioUrl?: string | null }; pages: ScorePage[]; segments: Segment[]; flags?: KaraokeFlag[]; audioDuration?: number | null; export?: ExportSettings; highlight: { opacity: number; mode?: 'wipe' | 'full'; color?: string } }

export const initialProject: Project = { version: 1, projectName: '未命名歌曲', source: { pdf: null, audio: null }, pages: [], segments: [], flags: [], highlight: { opacity: 0.32, mode: 'wipe' }, export: { preset: 'landscape', width: 1920, height: 1080, fps: 30, scoreZoom: 1 } }
