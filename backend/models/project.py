from pydantic import BaseModel, Field, model_validator


class NormalizedRegion(BaseModel):
    """A rectangle expressed as fractions of the original PDF page."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def fits_page(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("标注区域必须位于页面范围内")
        return self


class SyncAnchor(BaseModel):
    time: float = Field(ge=0)
    progress: float = Field(ge=0, le=1)


class ProjectSegment(BaseModel):
    id: str
    pageId: str
    region: NormalizedRegion
    startTime: float = Field(ge=0)
    endTime: float = Field(gt=0)
    direction: str = "left-to-right"
    text: str | None = None
    anchors: list[SyncAnchor] = []
    cuts: list[float] = []

    @model_validator(mode="after")
    def valid_times(self):
        if self.startTime >= self.endTime:
            raise ValueError("片段结束时间必须晚于开始时间")
        if any(anchor.time < self.startTime or anchor.time > self.endTime for anchor in self.anchors):
            raise ValueError("同步锚点必须位于片段起止时间内")
        if self.anchors != sorted(self.anchors, key=lambda anchor: anchor.time):
            raise ValueError("同步锚点必须按时间排序")
        if self.anchors != sorted(self.anchors, key=lambda anchor: anchor.progress):
            raise ValueError("同步锚点进度必须从左向右递增")
        if any(cut <= 0 or cut >= 1 for cut in self.cuts) or self.cuts != sorted(set(self.cuts)):
            raise ValueError("竖切线必须位于乐句内部，且从左到右排列")
        return self


class ProjectDocument(BaseModel):
    version: int = 1
    projectName: str = "未命名歌曲"
    projectId: str | None = None
    source: dict
    pages: list[dict]
    segments: list[ProjectSegment]
    flags: list[dict] = []
    audioDuration: float | None = Field(default=None, gt=0)
    export: dict = {"preset": "landscape", "width": 1920, "height": 1080, "fps": 30, "scoreZoom": 1.0}
    highlight: dict = {"opacity": 0.32}

    @model_validator(mode="after")
    def valid_segment_pages(self):
        page_ids = {page.get("id") for page in self.pages}
        if any(segment.pageId not in page_ids for segment in self.segments):
            raise ValueError("片段引用了不存在的乐谱页")
        return self
