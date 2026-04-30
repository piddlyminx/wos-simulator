"""RapidOCR v3 adapter for the legacy rapidocr-onnxruntime call shape."""
from __future__ import annotations

from typing import Any


def _enum_value(enum_cls: Any, name: str, fallback: str) -> Any:
    return getattr(enum_cls, name, fallback)


def _default_params(*, use_angle_cls: bool = False) -> dict[str, Any]:
    from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion

    onnx = _enum_value(EngineType, "ONNXRUNTIME", "onnxruntime")
    mobile = _enum_value(ModelType, "MOBILE", "mobile")
    server = _enum_value(ModelType, "SERVER", "server")
    ppocrv5 = _enum_value(OCRVersion, "PPOCRV5", "PP-OCRv5")

    params: dict[str, Any] = {
        "Global.use_cls": use_angle_cls,
        "Det.engine_type": onnx,
        "Det.lang_type": _enum_value(LangDet, "CH", "ch"),
        "Det.model_type": server,
        "Det.ocr_version": ppocrv5,
        "Rec.engine_type": onnx,
        "Rec.lang_type": _enum_value(LangRec, "EN", "en"),
        "Rec.model_type": mobile,
        "Rec.ocr_version": ppocrv5,
    }
    if use_angle_cls:
        params.update(
            {
                "Cls.engine_type": onnx,
                "Cls.lang_type": _enum_value(LangDet, "CH", "ch"),
                "Cls.model_type": mobile,
                "Cls.ocr_version": ppocrv5,
            }
        )
    return params


class RapidOCR:
    """Compatibility wrapper returning ``(lines, elapsed)`` like rapidocr-onnxruntime."""

    _instances: dict[tuple[bool, tuple[tuple[str, str], ...]], "RapidOCR"] = {}

    def __new__(
        cls,
        *args: Any,
        use_angle_cls: bool = False,
        params: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> "RapidOCR":
        params_key = tuple(sorted((params or {}).items(), key=lambda item: item[0]))
        cache_key = (use_angle_cls, tuple((str(key), repr(value)) for key, value in params_key))
        if cache_key not in cls._instances:
            instance = super().__new__(cls)
            instance._cache_key = cache_key
            cls._instances[cache_key] = instance
        return cls._instances[cache_key]

    def __init__(self, *args: Any, use_angle_cls: bool = False, params: dict[str, Any] | None = None, **kwargs: Any) -> None:
        if getattr(self, "_initialized", False):
            return

        from rapidocr import RapidOCR as _RapidOCR

        merged_params = _default_params(use_angle_cls=use_angle_cls)
        if params:
            merged_params.update(params)
        self._engine = _RapidOCR(params=merged_params)
        self._use_angle_cls = use_angle_cls
        self._initialized = True

    def __call__(self, img: Any, *args: Any, **kwargs: Any) -> tuple[list[tuple[list[list[float]], str, float]], float]:
        kwargs.setdefault("use_cls", self._use_angle_cls)
        output = self._engine(img, *args, **kwargs)
        return _to_legacy_lines(output), float(getattr(output, "elapse", 0.0) or 0.0)


_cached_default: RapidOCR | None = None
_cached_no_cls: RapidOCR | None = None


def get_rapid_ocr(*, use_angle_cls: bool = False) -> RapidOCR:
    global _cached_default, _cached_no_cls
    if use_angle_cls:
        if _cached_default is None:
            _cached_default = RapidOCR(use_angle_cls=True)
        return _cached_default
    if _cached_no_cls is None:
        _cached_no_cls = RapidOCR(use_angle_cls=False)
    return _cached_no_cls


def _to_legacy_lines(output: Any) -> list[tuple[list[list[float]], str, float]]:
    if isinstance(output, tuple):
        lines = output[0] if output else None
        return list(lines or [])

    boxes = getattr(output, "boxes", None)
    texts = getattr(output, "txts", None)
    scores = getattr(output, "scores", None)
    if boxes is None or texts is None:
        return []

    lines: list[tuple[list[list[float]], str, float]] = []
    if scores is None:
        scores = [0.0] * len(texts)

    for box, text, score in zip(boxes, texts, scores):
        box_list = box.tolist() if hasattr(box, "tolist") else box
        lines.append((box_list, str(text), float(score)))
    return lines
