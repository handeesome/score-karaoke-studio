from pydantic import BaseModel, Field, model_validator


class NormalizedRegion(BaseModel):
    """A rectangle expressed as fractions of the score page."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def fits_page(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("标注区域必须位于页面范围内")
        return self


class SegmentRegion(BaseModel):
    pageId: str
    region: NormalizedRegion


class ProjectSegment(BaseModel):
    id: str
    pageId: str
    region: NormalizedRegion
    regions: list[SegmentRegion] | None = None
    startTime: float = Field(ge=0)
    endTime: float = Field(gt=0)
    timingSet: bool = False
    direction: str = "left-to-right"
    text: str | None = None
    @model_validator(mode="after")
    def valid_times(self):
        if self.startTime >= self.endTime:
            raise ValueError("片段结束时间必须晚于开始时间")
        if self.regions is not None and not self.regions:
            raise ValueError("合并乐句至少需要一个标注框")
        return self


class ProjectDocument(BaseModel):
    version: int = 1
    projectName: str = "未命名歌曲"
    projectId: str | None = None
    scoreTimingBound: bool = False
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
        if any(part.pageId not in page_ids for segment in self.segments for part in (segment.regions or [SegmentRegion(pageId=segment.pageId, region=segment.region)])):
            raise ValueError("片段引用了不存在的乐谱页")
        return self
