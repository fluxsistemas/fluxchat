"""
Utilidades para el manejo de archivos multimedia.

Incluye la compresión de video con ffmpeg para ajustar el archivo al límite
de WhatsApp (16 MB) sin degradar la calidad de forma perceptible.
"""

import os
import json
import shutil
import subprocess

# Límite de WhatsApp para video (16 MB). Solo se comprime si se supera este valor.
WHATSAPP_VIDEO_LIMIT_MB = 16
# Tamaño objetivo de salida: un poco por debajo del límite para dejar margen
# al overhead del contenedor y garantizar que WhatsApp lo acepte.
DEFAULT_TARGET_MB = 15.5

# Resolución máxima de salida. 720p es un excelente balance calidad/peso.
MAX_WIDTH = 1280
MAX_HEIGHT = 720

# Bitrate de audio (AAC). 128 kbps es más que suficiente para voz/música.
AUDIO_BITRATE_KBPS = 128


def is_video_mimetype(mimetype: str | None) -> bool:
    return bool(mimetype) and mimetype.startswith("video/")


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _probe_duration_seconds(input_path: str) -> float | None:
    """Devuelve la duración del video en segundos usando ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                input_path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        data = json.loads(result.stdout or "{}")
        duration = float(data.get("format", {}).get("duration", 0) or 0)
        return duration if duration > 0 else None
    except Exception as e:
        print(f"[media_utils] No se pudo obtener la duración del video: {e}", flush=True)
        return None


def _run_ffmpeg(args: list[str], timeout: int = 1800) -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            print(f"[media_utils] ffmpeg falló (código {result.returncode}): {result.stderr[:500]}", flush=True)
            return False
        return True
    except subprocess.TimeoutExpired:
        print("[media_utils] ffmpeg excedió el tiempo máximo de ejecución.", flush=True)
        return False
    except Exception as e:
        print(f"[media_utils] Error ejecutando ffmpeg: {e}", flush=True)
        return False


def compress_video(
    input_path: str,
    output_path: str | None = None,
    target_mb: float = DEFAULT_TARGET_MB,
    trigger_mb: float = WHATSAPP_VIDEO_LIMIT_MB,
) -> str:
    """
    Comprime un video para que no supere `target_mb` megabytes.

    Estrategia:
      1. Solo se comprime si el archivo supera `trigger_mb` (por defecto 16 MB,
         el límite de WhatsApp). Si ya entra, se devuelve tal cual.
      2. Se calcula el bitrate de video necesario a partir de la duración y el
         tamaño objetivo, y se codifica en dos pasadas (libx264) para acertar
         el tamaño final.
      3. Se limita la resolución a 720p manteniendo el aspect ratio.

    Devuelve la ruta del archivo resultante (comprimido o el original).
    Si ffmpeg no está disponible o falla, devuelve el original sin romper el flujo.
    """
    if not os.path.exists(input_path):
        return input_path

    trigger_bytes = int(trigger_mb * 1024 * 1024)
    target_bytes = int(target_mb * 1024 * 1024)
    original_size = os.path.getsize(input_path)

    # Solo comprimimos si supera el límite de WhatsApp (16 MB).
    if original_size <= trigger_bytes:
        print(
            f"[media_utils] El video pesa {original_size / 1024 / 1024:.2f} MB "
            f"(<= {trigger_mb} MB), no requiere compresión.",
            flush=True,
        )
        return input_path

    if not _ffmpeg_available():
        print("[media_utils] ffmpeg no está disponible; se envía el video original.", flush=True)
        return input_path

    if output_path is None:
        base, _ = os.path.splitext(input_path)
        output_path = f"{base}_compressed.mp4"

    duration = _probe_duration_seconds(input_path)
    if not duration:
        print("[media_utils] No se pudo determinar la duración; se envía el video original.", flush=True)
        return input_path

    # Bitrate total disponible (bits por segundo) para el tamaño objetivo.
    total_bitrate_bps = (target_bytes * 8) / duration
    # Reservamos el bitrate de audio y un pequeño margen para el contenedor.
    video_bitrate_bps = total_bitrate_bps - (AUDIO_BITRATE_KBPS * 1000) - 16000
    video_bitrate_kbps = max(int(video_bitrate_bps / 1000), 200)  # piso de 200 kbps

    # Filtro de escala: reduce solo si excede 720p, manteniendo aspect ratio (par).
    scale_filter = (
        f"scale='min({MAX_WIDTH},iw)':'min({MAX_HEIGHT},ih)'"
        f":force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2"
    )

    passlog = f"{output_path}.ffmpeg2pass"
    common_args = [
        "-i", input_path,
        "-c:v", "libx264",
        "-preset", "medium",
        "-b:v", f"{video_bitrate_kbps}k",
        "-vf", scale_filter,
        "-c:a", "aac",
        "-b:a", f"{AUDIO_BITRATE_KBPS}k",
        "-movflags", "+faststart",
    ]

    # Primera pasada (solo analiza, sin audio).
    first_pass = [
        "-i", input_path,
        "-c:v", "libx264",
        "-preset", "medium",
        "-b:v", f"{video_bitrate_kbps}k",
        "-vf", scale_filter,
        "-pass", "1",
        "-passlogfile", passlog,
        "-an",
        "-f", "null",
        os.devnull,
    ]
    if not _run_ffmpeg(first_pass):
        _cleanup_passlog(passlog)
        return input_path

    # Segunda pasada (codifica el archivo final).
    second_pass = [
        *common_args,
        "-pass", "2",
        "-passlogfile", passlog,
        output_path,
    ]
    ok = _run_ffmpeg(second_pass)
    _cleanup_passlog(passlog)

    if not ok or not os.path.exists(output_path):
        return input_path

    compressed_size = os.path.getsize(output_path)
    # Si por alguna razón quedó más grande que el original, conservamos el original.
    if compressed_size >= original_size:
        try:
            os.remove(output_path)
        except OSError:
            pass
        return input_path

    print(
        f"[media_utils] Video comprimido: {original_size / 1024 / 1024:.2f} MB -> "
        f"{compressed_size / 1024 / 1024:.2f} MB (bitrate {video_bitrate_kbps} kbps).",
        flush=True,
    )
    return output_path


def _cleanup_passlog(passlog: str) -> None:
    for suffix in ("-0.log", "-0.log.mbtree", ".log", ".log.mbtree"):
        try:
            os.remove(f"{passlog}{suffix}")
        except OSError:
            pass
