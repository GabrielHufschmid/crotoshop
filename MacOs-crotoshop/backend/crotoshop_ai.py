#!/usr/bin/env python3
"""Fast local ISNet/ONNX sidecar for Crotoshop."""

from __future__ import annotations

import io
import json
import os
import sys
import threading
import traceback
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", str(min(8, max(1, (os.cpu_count() or 4) - 2))))
os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")

import numpy as np
import onnxruntime as ort
from PIL import Image

MODEL_NAME = "isnet-general-use.onnx"
_session: ort.InferenceSession | None = None
_session_lock = threading.Lock()


def model_path() -> Path:
    home = Path(os.path.expanduser(os.getenv("U2NET_HOME", "~/.u2net")))
    path = home / MODEL_NAME
    if not path.is_file():
        raise FileNotFoundError(f"No se encontró el modelo local: {path}")
    return path


def accelerated_providers() -> list[object] | None:
    available = ort.get_available_providers()
    if "CoreMLExecutionProvider" in available:
        cache_dir = Path(
            os.path.expanduser(
                os.getenv("CROTOSHOP_AI_CACHE", "~/Library/Caches/Crotoshop/CoreML")
            )
        )
        cache_dir.mkdir(parents=True, exist_ok=True)
        return [
            (
                "CoreMLExecutionProvider",
                {
                    "ModelCacheDirectory": str(cache_dir),
                    "RequireStaticInputShapes": "1",
                },
            ),
            "CPUExecutionProvider",
        ]
    if "DmlExecutionProvider" in available:
        return ["DmlExecutionProvider", "CPUExecutionProvider"]
    return None


def create_session(providers: list[object]) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = min(8, max(1, (os.cpu_count() or 4) - 2))
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = True
    options.enable_mem_pattern = True
    return ort.InferenceSession(str(model_path()), sess_options=options, providers=providers)


def start_sessions() -> None:
    global _session
    with _session_lock:
        if _session is not None:
            return
        providers = accelerated_providers()
        if providers:
            try:
                _session = create_session(providers)
                return
            except Exception:
                traceback.print_exc(file=sys.stderr)
        _session = create_session(["CPUExecutionProvider"])


def get_session() -> ort.InferenceSession:
    start_sessions()
    with _session_lock:
        assert _session is not None
        return _session


def input_tensor(image: Image.Image) -> np.ndarray:
    resized = image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    pixels = np.asarray(resized, dtype=np.float32)
    pixels /= max(float(np.max(pixels)), 1e-6)
    pixels -= 0.5
    return np.expand_dims(pixels.transpose((2, 0, 1)), 0).astype(np.float32)


def image_from_message(
    message: dict[str, object],
) -> tuple[Image.Image, bool, np.memmap | None]:
    input_path = Path(str(message["input"]))
    raw_rgba = message.get("format") == "rgba"
    if raw_rgba:
        width = int(message["width"])
        height = int(message["height"])
        if (
            width < 1
            or height < 1
            or width > 16_384
            or height > 16_384
            or width * height > 100_000_000
        ):
            raise ValueError("Dimensiones de imagen inválidas")
        if input_path.stat().st_size != width * height * 4:
            raise ValueError("El buffer RGBA no coincide con las dimensiones")
        pixels = np.memmap(
            input_path,
            dtype=np.uint8,
            mode="r",
            shape=(height, width, 4),
        )
        image = Image.frombuffer("RGBA", (width, height), pixels, "raw", "RGBA", 0, 1)
        return image, True, pixels
    return Image.open(input_path).convert("RGBA"), False, None


def close_mapping(mapping: np.memmap | None) -> None:
    if mapping is not None and mapping._mmap is not None:
        mapping._mmap.close()


def predict_mask(image: Image.Image) -> Image.Image:
    session = get_session()
    prediction = session.run(None, {session.get_inputs()[0].name: input_tensor(image)})[0][:, 0, :, :]
    low = float(np.min(prediction))
    high = float(np.max(prediction))
    mask_data = np.squeeze((prediction - low) / max(high - low, 1e-6))
    mask = Image.fromarray((mask_data * 255).astype(np.uint8), mode="L")
    return mask.resize(image.size, Image.Resampling.LANCZOS)


def remove_background(message: dict[str, object]) -> None:
    output_path = Path(str(message["output"]))
    image, raw_rgba, mapping = image_from_message(message)
    try:
        mask = predict_mask(image)
        image.putalpha(mask)
        if raw_rgba:
            np.asarray(image, dtype=np.uint8).tofile(output_path)
        else:
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=False)
            output_path.write_bytes(output.getvalue())
    finally:
        del image
        close_mapping(mapping)


def create_ai_mask(message: dict[str, object]) -> None:
    output_path = Path(str(message["output"]))
    image, _, mapping = image_from_message(message)
    try:
        mask = np.asarray(predict_mask(image), dtype=np.uint16)
        source_alpha = np.asarray(image.getchannel("A"), dtype=np.uint16)
        mask = ((mask * source_alpha + 127) // 255).astype(np.uint8)
        mask.tofile(output_path)
    finally:
        del image
        close_mapping(mapping)


def handle(message: dict[str, object]) -> dict[str, object]:
    action = message.get("action")
    if action == "health":
        return {"backend": "crotoshop-ai", "ready": True, "providers": get_session().get_providers()}
    if action == "remove_background":
        remove_background(message)
        return {"output": message["output"]}
    if action == "create_ai_mask":
        create_ai_mask(message)
        return {"output": message["output"]}
    raise ValueError(f"Acción de IA desconocida: {action}")


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            message = json.loads(line)
            request_id = message.get("id")
            response = {"id": request_id, "ok": True, **handle(message)}
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            response = {"id": request_id, "ok": False, "error": str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
