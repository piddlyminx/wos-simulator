#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy==2.4.2",
#   "opencv-python-headless==4.13.0.92",
#   "onnx==1.20.0",
#   "onnxruntime==1.23.2",
#   "pytesseract==0.3.13",
#   "rapidocr==3.7.0",
#   "scikit-learn==1.8.0",
#   "torch==2.8.0",
# ]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Train the small ONNX fire-crystal badge classifier used by report parsing."""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np
import torch
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit

SKILL_DIR = Path(__file__).resolve().parent.parent
ROOT = SKILL_DIR.parent
SCRIPTS = SKILL_DIR / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import report_stats_parser as report_parser

MODEL_PATH = SKILL_DIR / "models" / "fire_crystal_badge.onnx"
EXPECTED_PATH = ROOT / "tests" / "fixtures" / "dashboard_report_expected.json"
REPORT_DIR = ROOT / "dashboard" / "test_reports"
MODEL_WIDTH = 96
MODEL_HEIGHT = 48
BACKGROUND_VALUE = 235
RANDOM_SEED = 17


@dataclass(frozen=True)
class Sample:
    image: np.ndarray
    valid: np.ndarray
    label: int
    group: str


class BadgeNet(torch.nn.Module):
    def __init__(self, class_count: int) -> None:
        super().__init__()
        self.body = torch.nn.Sequential(
            torch.nn.Conv2d(3, 12, 5, padding=2),
            torch.nn.ReLU(),
            torch.nn.MaxPool2d(2),
            torch.nn.Conv2d(12, 24, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.MaxPool2d(2),
            torch.nn.Conv2d(24, 40, 5, padding=2),
            torch.nn.ReLU(),
            torch.nn.Conv2d(40, 48, 3, padding=1),
            torch.nn.ReLU(),
            torch.nn.AdaptiveMaxPool2d(1),
        )
        self.head = torch.nn.Linear(48, class_count)

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return self.head(self.body(features).flatten(1))


class ExportedBadgeNet(torch.nn.Module):
    def __init__(self, model: BadgeNet, classes: np.ndarray) -> None:
        super().__init__()
        self.model = model
        self.register_buffer("class_values", torch.from_numpy(classes.astype(np.int64)))

    def forward(self, features: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return self.model(features), self.class_values


def _features(sample: Sample) -> np.ndarray:
    hsv = cv2.cvtColor(sample.image, cv2.COLOR_BGR2HSV)
    saturation_value = cv2.resize(
        hsv[:, :, 1:3],
        (MODEL_WIDTH, MODEL_HEIGHT),
        interpolation=cv2.INTER_AREA,
    ).astype(np.float32)
    valid = cv2.resize(
        sample.valid,
        (MODEL_WIDTH, MODEL_HEIGHT),
        interpolation=cv2.INTER_NEAREST,
    ).astype(np.float32)[:, :, None]
    return np.transpose(np.concatenate((saturation_value, valid), axis=2), (2, 0, 1)) / 255.0


def _augment(sample: Sample, rng: np.random.Generator) -> Sample:
    height, width = sample.image.shape[:2]
    transform = cv2.getRotationMatrix2D(
        (width / 2, height / 2),
        float(rng.uniform(-5.0, 5.0)),
        float(rng.uniform(0.82, 1.18)),
    )
    transform[:, 2] += (float(rng.uniform(-7.0, 7.0)), float(rng.uniform(-5.0, 5.0)))
    image = cv2.warpAffine(
        sample.image,
        transform,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(BACKGROUND_VALUE,) * 3,
    )
    valid = cv2.warpAffine(
        sample.valid,
        transform,
        (width, height),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    image = cv2.convertScaleAbs(
        image,
        alpha=float(rng.uniform(0.82, 1.18)),
        beta=float(rng.uniform(-18.0, 18.0)),
    )
    if rng.random() < 0.35:
        image = cv2.GaussianBlur(image, (3, 3), float(rng.uniform(0.2, 1.0)))
    if rng.random() < 0.35:
        quality = int(rng.integers(35, 96))
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok:
            image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)

    missing = np.zeros((height, width), dtype=np.uint8)
    clip = int(rng.integers(0, 19))
    mode = int(rng.integers(0, 9))
    if clip:
        if mode in (1, 5):
            missing[:clip, :] = 255
        elif mode == 2:
            missing[-clip:, :] = 255
        elif mode == 3:
            missing[:, :clip] = 255
        elif mode in (4, 6):
            missing[:, -clip:] = 255
        elif mode == 7:
            cv2.fillConvexPoly(
                missing,
                np.asarray([[width - clip, 0], [width, 0], [width, clip]], dtype=np.int32),
                255,
            )
        elif mode == 8:
            cv2.fillConvexPoly(
                missing,
                np.asarray([[0, 0], [clip, 0], [0, clip]], dtype=np.int32),
                255,
            )
        if mode == 5:
            missing[:, :clip] = 255
        elif mode == 6:
            missing[:clip, :] = 255
    image[missing > 0] = BACKGROUND_VALUE
    valid[missing > 0] = 0
    return Sample(image, valid, sample.label, sample.group)


def _report_samples(cache_path: Path | None) -> list[Sample]:
    if cache_path is not None and cache_path.exists():
        cache = np.load(cache_path)
        return [
            Sample(image, valid, int(label), str(group))
            for image, valid, label, group in zip(
                cache["images"],
                cache["valid"],
                cache["labels"],
                cache["groups"],
            )
        ]

    expected = json.loads(EXPECTED_PATH.read_text())
    samples: list[Sample] = []
    for report_name, truth in expected.items():
        path = REPORT_DIR / report_name
        result = report_parser.extract_report_stats_and_troops(path)
        image = cv2.imread(str(path))
        if image is None:
            raise FileNotFoundError(path)
        image, _content_box = report_parser._trim_uniform_border(image)
        for side in ("left", "right"):
            for troop in result[side]["troops"]:
                slot = int(troop["slot"])
                count_box = result["meta"]["slot_count_boxes"].get(str(slot))
                if count_box is None:
                    continue
                truth_troop = truth[side]["troops"][troop["type"]]
                crop, valid = report_parser._fire_crystal_badge_classifier_crop(
                    image,
                    slot,
                    report_parser.OCRItem(**count_box),
                )
                samples.append(
                    Sample(crop, valid, int(truth_troop["fire_crystal_level"] or 0), report_name)
                )
    if cache_path is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            cache_path,
            images=np.stack([sample.image for sample in samples]),
            valid=np.stack([sample.valid for sample in samples]),
            labels=np.asarray([sample.label for sample in samples]),
            groups=np.asarray([sample.group for sample in samples]),
        )
    return samples


def _template_samples(backgrounds: list[Sample]) -> list[Sample]:
    samples: list[Sample] = []
    empty = [sample for sample in backgrounds if sample.label == 0]
    for path in sorted((SKILL_DIR / "templates" / "fire_crystal_badges").glob("fc*.png")):
        try:
            level = int(path.stem.removeprefix("fc"))
        except ValueError:
            continue
        badge = cv2.imread(str(path))
        if badge is None:
            continue
        for index, background in enumerate(empty[:24]):
            image = background.image.copy()
            height, width = badge.shape[:2]
            x1 = int(round(image.shape[1] * 0.84 - width / 2))
            y1 = int(round(image.shape[0] * 0.28 - height / 2))
            x1 = min(max(0, x1), image.shape[1] - width)
            y1 = min(max(0, y1), image.shape[0] - height)
            image[y1 : y1 + height, x1 : x1 + width] = badge
            samples.append(Sample(image, background.valid.copy(), level, f"template-{path.name}-{index}"))
    return samples


def _balanced_training_samples(samples: list[Sample], variants: int) -> list[Sample]:
    rng = np.random.default_rng(RANDOM_SEED)
    by_label: dict[int, list[Sample]] = {}
    for sample in samples:
        by_label.setdefault(sample.label, []).append(sample)
    target = max(len(group) for group in by_label.values()) * variants
    balanced: list[Sample] = []
    for _label, group in sorted(by_label.items()):
        for index in range(target):
            sample = group[index % len(group)]
            balanced.append(sample if index < len(group) else _augment(sample, rng))
    return balanced


def _train(
    samples: list[Sample],
    classes: np.ndarray,
    *,
    variants: int,
    epochs: int,
    validation: list[Sample] | None = None,
) -> BadgeNet:
    torch.manual_seed(RANDOM_SEED)
    balanced = _balanced_training_samples(samples, variants)
    class_indices = {int(level): index for index, level in enumerate(classes)}
    features = torch.from_numpy(np.stack([_features(sample) for sample in balanced]))
    labels = torch.tensor([class_indices[sample.label] for sample in balanced], dtype=torch.long)
    model = BadgeNet(len(classes))
    optimiser = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=2e-4)
    loss_function = torch.nn.CrossEntropyLoss()
    generator = torch.Generator().manual_seed(RANDOM_SEED)
    best_accuracy = -1.0
    best_state = None
    validation_features = (
        torch.from_numpy(np.stack([_features(sample) for sample in validation]))
        if validation
        else None
    )
    validation_labels = np.asarray([sample.label for sample in validation]) if validation else None
    for _epoch in range(epochs):
        model.train()
        order = torch.randperm(len(features), generator=generator)
        for start in range(0, len(order), 64):
            indices = order[start : start + 64]
            optimiser.zero_grad()
            loss = loss_function(model(features[indices]), labels[indices])
            loss.backward()
            optimiser.step()
        if validation_features is not None and validation_labels is not None:
            model.eval()
            with torch.no_grad():
                prediction = classes[model(validation_features).argmax(1).numpy()]
            accuracy = float(np.mean(prediction == validation_labels))
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_state = copy.deepcopy(model.state_dict())
    if best_state is not None:
        model.load_state_dict(best_state)
    return model.eval()


def _export(model: BadgeNet, classes: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        ExportedBadgeNet(model, classes).eval(),
        torch.zeros((1, 3, MODEL_HEIGHT, MODEL_WIDTH), dtype=torch.float32),
        output_path,
        input_names=["features"],
        output_names=["logits", "classes"],
        dynamic_axes={"features": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=MODEL_PATH)
    parser.add_argument("--variants", type=int, default=10)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--validation-seeds", default="17,7,41")
    parser.add_argument("--cache", type=Path, default=Path("/tmp/wos-fire-crystal-badge-samples-v2.npz"))
    parser.add_argument("--extract-only", action="store_true")
    args = parser.parse_args()

    torch.manual_seed(RANDOM_SEED)
    torch.set_num_threads(min(4, max(1, os.cpu_count() or 1)))
    started = perf_counter()
    reports = _report_samples(args.cache)
    counts = {
        level: sum(sample.label == level for sample in reports)
        for level in sorted({sample.label for sample in reports})
    }
    print(f"report_samples={len(reports)} class_counts={counts} load_seconds={perf_counter() - started:.2f}")
    if args.extract_only:
        return 0

    groups = np.asarray([sample.group for sample in reports])
    labels = np.asarray([sample.label for sample in reports])
    for seed in (int(value) for value in args.validation_seeds.split(",") if value.strip()):
        train_indices, test_indices = next(
            GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=seed).split(
                reports,
                labels,
                groups,
            )
        )
        train = [reports[index] for index in train_indices]
        held_out = [reports[index] for index in test_indices]
        train.extend(_template_samples(train))
        classes = np.asarray(sorted({sample.label for sample in train}), dtype=np.int64)
        stage = perf_counter()
        validation_model = _train(
            train,
            classes,
            variants=args.variants,
            epochs=args.epochs,
            validation=held_out,
        )
        held_out_features = torch.from_numpy(np.stack([_features(sample) for sample in held_out]))
        with torch.no_grad():
            held_out_logits = validation_model(held_out_features)
            held_out_prediction = classes[held_out_logits.argmax(1).numpy()]
        held_out_labels = np.asarray([sample.label for sample in held_out])
        visible_labels = sorted(set(held_out_labels) | set(held_out_prediction))
        errors = [
            (held_out[index].group, int(expected), int(actual))
            for index, (expected, actual) in enumerate(zip(held_out_labels, held_out_prediction))
            if expected != actual
        ]
        print(
            f"validation_seed={seed} held_out_reports={sorted(set(groups[test_indices]))} "
            f"accuracy={float(np.mean(held_out_prediction == held_out_labels)):.4f} errors={errors}"
        )
        print(confusion_matrix(held_out_labels, held_out_prediction, labels=visible_labels))
        print(classification_report(held_out_labels, held_out_prediction, labels=visible_labels, zero_division=0))
        print(f"validation_seconds={perf_counter() - stage:.2f}")

    final_samples = reports + _template_samples(reports)
    classes = np.asarray(sorted({sample.label for sample in final_samples}), dtype=np.int64)
    final_model = _train(
        final_samples,
        classes,
        variants=args.variants,
        epochs=args.epochs,
        validation=reports,
    )
    _export(final_model, classes, args.out)
    print(
        f"classes={classes.tolist()} missing_classes={sorted(set(range(11)) - set(classes))} "
        f"parameters={sum(parameter.numel() for parameter in final_model.parameters())} "
        f"model_bytes={args.out.stat().st_size} wrote={args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
