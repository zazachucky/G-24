#!/usr/bin/env python3
"""Compose real garment-demonstration clips into a portrait review MP4.

Run with tools-local/venv-sadtalker/bin/python scripts/render_portrait_shopping.py
  PLAN.json OUTPUT.mp4 [--root PROJECT_ROOT]

Each scene requires video_path, start_s, duration_s, source_start_s and an explicit
playback_rate in [0.5, 1.0]. Audio start/end are ABSOLUTE output timeline times;
scene audio_path starts at audio_source_start_s (default 0). A top-level audio_path
is also accepted, in which case its default source start equals audio_start_s.
Narration text requires an audio file. Empty narration creates a silent AAC track.
The output is always 720x1280, 24 fps. No source video is looped or end-padded.
Optional scene.motion_interpolation="minterpolate" uses CPU optical flow before
upscaling; the default is "none". It needs two additional source frames for
lookahead, so a 25-frame/6-fps clip at 0.5x supports 7.5s safely, not 8s.
"""
import argparse
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS = 720, 1280, 24
VIDEO_Y, VIDEO_HEIGHT = 148, 892
FONT = Path('/System/Library/Fonts/AppleSDGothicNeo.ttc')
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(arguments):
    result = subprocess.run([FFMPEG, '-hide_banner', '-nostdin', *arguments],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-7000:])
    return result


def resolve(value, root):
    path = Path(value).expanduser()
    return (path if path.is_absolute() else root / path).resolve()


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def video_info(path):
    # Decode the entire video stream, rather than trusting a container duration
    # that may be longer than its video because of an audio tail.
    reader = imageio_ffmpeg.read_frames(str(path))
    try:
        data = next(reader)
    finally:
        reader.close()
    frames, decoded_duration = imageio_ffmpeg.count_frames_and_secs(str(path))
    require(frames > 1 and data['fps'] > 0, f'Not a video clip: {path}')
    require(data.get('codec', '').lower() not in ('png', 'mjpeg', 'gif'),
            f'Image/image sequence is not an accepted source clip: {path}')
    duration = min(frames / data['fps'], decoded_duration + 0.011)
    return {'width': data['size'][0], 'height': data['size'][1],
            'fps': data['fps'], 'frames': frames, 'duration_s': duration,
            'codec': data.get('codec'), 'sha256': sha256(path)}


def audio_duration(path):
    result = run(['-v', 'error', '-i', str(path), '-map', '0:a:0',
                  '-progress', 'pipe:1', '-f', 'null', '-'])
    times = re.findall(r'^out_time_us=(\d+)$', result.stdout, re.M)
    require(times, f'No decodable audio stream: {path}')
    return int(times[-1]) / 1_000_000


def number(value, label):
    require(isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value), f'{label} must be a finite number')
    return float(value)


def wrap(draw, value, font, width, max_lines, label):
    lines = []
    for paragraph in value.split('\n'):
        line = ''
        for char in paragraph:
            candidate = line + char
            if line and draw.textlength(candidate, font=font) > width:
                lines.append(line.rstrip())
                line = char.lstrip()
            else:
                line = candidate
        if line:
            lines.append(line.rstrip())
    require(len(lines) <= max_lines,
            f'{label} is too long for {max_lines} lines; shorten the text')
    return lines


def text(draw, value, xy, size, *, width=672, max_lines=1, fill='#203631',
         label='text', spacing=5):
    font = ImageFont.truetype(str(FONT), size=size, index=4)
    lines = wrap(draw, value, font, width, max_lines, label)
    draw.multiline_text(xy, '\n'.join(lines), font=font, fill=fill,
                        spacing=spacing, stroke_width=0)


def graphics(scene, directory):
    # These are newly drawn broadcast graphics; the underlying moving video is
    # never replaced by a still or stretched with a frozen final frame.
    image = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 719, VIDEO_Y - 1), fill='#F5F1EA')
    draw.rectangle((0, 1040, 719, 1279), fill='#F5F1EA')
    draw.rectangle((0, 0, 719, 4), fill='#006A52')
    text(draw, 'GS AI LIVE', (24, 24), 30)
    text(draw, 'AI 가상인물 · 데모', (414, 30), 23, width=282)
    text(draw, scene.get('title', scene.get('mainheading', '')), (24, 81), 28,
         label='scene title')
    captions = scene.get('caption_lines', [])
    require(isinstance(captions, list) and all(isinstance(x, str) for x in captions),
            'caption_lines must be a string array')
    text(draw, ' · '.join(captions), (24, 118), 21, label='caption_lines')
    draw.rectangle((0, 1144, 719, 1279), fill='#FFFFFF')
    draw.rectangle((0, 1144, 719, 1146), fill='#D5DDD4')
    text(draw, 'SJ와니 샤이니 크리즈 캐시미어 풀오버 1종', (24, 1159), 25)
    text(draw, '상의 1종  49,900원', (24, 1196), 35)
    text(draw, '하의·신발 별도', (473, 1208), 24, width=224)
    text(draw, '2026.09.21 상품 정보 스냅샷 · 주문 전 확인', (24, 1250), 20)
    chrome = directory / 'graphics.png'
    image.save(chrome)
    subtitle = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    text(ImageDraw.Draw(subtitle), scene.get('narration', ''), (24, 1048), 26,
         max_lines=3, label='narration', spacing=5)
    subtitle_path = directory / 'subtitle.png'
    subtitle.save(subtitle_path)
    return chrome, subtitle_path


def validate(plan, root):
    require(plan.get('width', WIDTH) == WIDTH and plan.get('height', HEIGHT) == HEIGHT
            and plan.get('fps', FPS) == FPS, 'Output must be 720x1280 at 24 fps')
    require(plan.get('source_snapshot_date', '2026-09-21') in ('2026-09-21', '2026.09.21'),
            'Product graphics are verified only for the 2026-09-21 snapshot')
    scenes = plan.get('scenes', [])
    require(scenes, 'Plan has no scenes')
    source_cache, audio_cache, used_intervals = {}, {}, {}
    cursor = 0.0
    for i, scene in enumerate(scenes):
        label = f'scene {i + 1}'
        start = number(scene['start_s'], label + ' start_s')
        duration = number(scene['duration_s'], label + ' duration_s')
        offset = number(scene['source_start_s'], label + ' source_start_s')
        rate = number(scene['playback_rate'], label + ' playback_rate')
        interpolation = scene.get('motion_interpolation', 'none')
        require(interpolation in ('none', 'minterpolate'),
                f'{label}: motion_interpolation must be none or minterpolate')
        frames = round(duration * FPS)
        require(abs(start - cursor) < 0.002, f'{label}: gap/overlap in timeline')
        require(duration > 0 and abs(frames / FPS - duration) < 0.002,
                f'{label}: duration_s must align to 24 fps frames')
        duration = frames / FPS
        require(offset >= 0 and 0.5 <= rate <= 1.0,
                f'{label}: source_start_s >= 0, playback_rate in [0.5, 1.0] required')
        path = resolve(scene['video_path'], root)
        require(path.is_file(), f'{label}: missing video: {path}')
        require(path.suffix.lower() in ('.mp4', '.mov', '.mkv', '.webm'),
                f'{label}: an actual video file is required')
        # The superseded face-only experiments cannot be silently reused.
        normalized = str(path).lower()
        require('/video/home-shopping/' not in normalized and
                'sadtalker' not in normalized and 'host-120s' not in normalized,
                f'{label}: superseded face-only source is not accepted')
        if path not in source_cache:
            print(f'Validating video: {path}', flush=True)
            source_cache[path] = video_info(path)
        info = source_cache[path]
        source_end = offset + duration * rate
        # MCI needs future real frames. It cannot synthesize the final interval
        # without lookahead; never satisfy this with tpad, freeze or looping.
        lookahead = 2 / info['fps'] if interpolation == 'minterpolate' else 0
        decode_end = source_end + lookahead
        require(decode_end <= info['duration_s'] + 0.002,
                f'{label}: needs source through {decode_end:.3f}s'
                f' (including {lookahead:.3f}s interpolation lookahead), but only '
                f'{info["duration_s"]:.3f}s exists; freeze/loop padding is prohibited')
        for prior_start, prior_end in used_intervals.setdefault(path, []):
            require(source_end <= prior_start + 0.002 or offset >= prior_end - 0.002,
                    f'{label}: source interval repeats earlier footage; loops are prohibited')
        used_intervals[path].append((offset, source_end))
        audio_value = scene.get('audio_path') or plan.get('audio_path')
        audio = None
        narration = scene.get('narration', '')
        require(isinstance(narration, str), f'{label}: narration must be a string')
        require(not narration or audio_value, f'{label}: narration needs an audio_path')
        if audio_value:
            audio = resolve(audio_value, root)
            require(audio.is_file(), f'{label}: missing audio: {audio}')
            audio_start = number(scene['audio_start_s'], label + ' audio_start_s')
            audio_end = number(scene['audio_end_s'], label + ' audio_end_s')
            source_audio_start = number(scene.get('audio_source_start_s',
                0 if scene.get('audio_path') else audio_start), label + ' audio_source_start_s')
            require(start <= audio_start < audio_end <= start + duration + 0.002,
                    f'{label}: audio_start_s/audio_end_s must lie inside its scene')
            require(source_audio_start >= 0, f'{label}: negative audio source offset')
            if audio not in audio_cache:
                audio_cache[audio] = audio_duration(audio)
            require(source_audio_start + audio_end - audio_start <= audio_cache[audio] + 0.003,
                    f'{label}: audio file is shorter than the requested audio interval')
        else:
            audio_start, audio_end, source_audio_start = start, start + duration, 0
        scene['_render'] = {'video_path': str(path), 'source': info, 'frames': frames,
            'duration_s': duration, 'source_end_s': source_end,
            'decode_end_s': decode_end, 'interpolation_lookahead_s': lookahead,
            'motion_interpolation': interpolation,
            'audio_path': str(audio) if audio else None, 'audio_start_s': audio_start,
            'audio_end_s': audio_end, 'audio_source_start_s': source_audio_start,
            'upscaled': min(WIDTH / info['width'], VIDEO_HEIGHT / info['height']) > 1}
        cursor += duration
    require(0 < cursor <= 120, 'Total duration must be > 0 and <= 120 seconds')
    require(abs(number(plan.get('duration_s', cursor), 'duration_s') - cursor) < 0.002,
            'Plan duration_s does not match its scenes')
    return cursor


def render_scene(scene, directory):
    directory.mkdir()
    data = scene['_render']
    chrome, subtitle = graphics(scene, directory)
    local_audio_start = data['audio_start_s'] - scene['start_s']
    local_audio_end = data['audio_end_s'] - scene['start_s']
    frame_conversion = (
        f'minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,'
        if data['motion_interpolation'] == 'minterpolate' else f'fps={FPS}:round=near,'
    )
    graph = (
        f'[0:v]trim=start={scene["source_start_s"]}:end={data["decode_end_s"]},'
        f'setpts=(PTS-STARTPTS)/{scene["playback_rate"]},{frame_conversion}'
        f'trim=duration={data["duration_s"]},'
        f'scale={WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=decrease:'
        'force_divisible_by=2:flags=lanczos,setsar=1,'
        f'pad={WIDTH}:{HEIGHT}:(ow-iw)/2:{VIDEO_Y}+( {VIDEO_HEIGHT}-ih)/2:'
        'color=0xF5F1EA[base];'
        '[base][1:v]overlay=0:0:eof_action=repeat:shortest=1[chrome];'
        '[chrome][2:v]overlay=0:0:eof_action=repeat:shortest=1:'
        f"enable='gte(t,{local_audio_start})*lt(t,{local_audio_end})'[out]"
    )
    output = directory / 'scene.mp4'
    # Only transparent graphics repeat; [0:v] remains the finite moving clip.
    run(['-v', 'error', '-threads', '2', '-i', data['video_path'],
         '-loop', '1', '-framerate', str(FPS), '-i', str(chrome),
         '-loop', '1', '-framerate', str(FPS), '-i', str(subtitle),
         '-filter_complex_threads', '1', '-filter_complex', graph,
         '-map', '[out]', '-an', '-frames:v', str(data['frames']), '-c:v', 'libx264',
         '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-threads', '2',
         '-fps_mode', 'passthrough', '-video_track_timescale', '24000', str(output)])
    info = video_info(output)
    require(info['frames'] == data['frames'],
            f'Source ended early: expected {data["frames"]} frames, got {info["frames"]}')
    return output


def render_audio(scenes, duration, directory):
    args = ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    filters, names = [], ['[0:a]']
    index = 1
    for scene in scenes:
        data = scene['_render']
        if not data['audio_path']:
            continue
        args.extend(['-i', data['audio_path']])
        offset = data['audio_source_start_s']
        length = data['audio_end_s'] - data['audio_start_s']
        delay_samples = round(data['audio_start_s'] * 48000)
        filters.append(f'[{index}:a]atrim=start={offset}:end={offset + length},'
            f'asetpts=PTS-STARTPTS,aresample=48000,adelay={delay_samples}S:all=1[a{index}]')
        names.append(f'[a{index}]')
        index += 1
    filters.append(''.join(names) + f'amix=inputs={len(names)}:duration=first:'
                   f'dropout_transition=0:normalize=0,atrim=duration={duration}[audio]')
    output = directory / 'narration.m4a'
    run([*args, '-filter_complex_threads', '1', '-filter_complex', ';'.join(filters),
         '-map', '[audio]', '-t', str(duration), '-c:a', 'aac', '-b:a', '160k',
         '-ar', '48000', '-ac', '2', str(output)])
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    require(not output.exists(), f'Refusing to overwrite existing output: {output}')
    require(FONT.is_file(), f'Korean font missing: {FONT}')
    plan = json.loads(args.plan.read_text())
    duration = validate(plan, root)
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = output.with_suffix('.metadata.json')
    require(not metadata_path.exists(), f'Refusing to overwrite metadata: {metadata_path}')
    with tempfile.TemporaryDirectory(prefix='portrait-shopping-') as temp:
        directory = Path(temp)
        clips = []
        for index, scene in enumerate(plan['scenes']):
            print(f'Rendering scene {index + 1}/{len(plan["scenes"])}', flush=True)
            clips.append(render_scene(scene, directory / f'scene-{index + 1:02d}'))
        concat = directory / 'concat.txt'
        concat.write_text(''.join(f"file '{clip}'\n" for clip in clips))
        audio = render_audio(plan['scenes'], duration, directory)
        staged = directory / 'finished.mp4'
        run(['-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(concat),
             '-i', str(audio), '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
             '-movflags', '+faststart', str(staged)])
        info = video_info(staged)
        require(info['frames'] == round(duration * FPS) and info['fps'] == FPS,
                'Final frame count / frame rate mismatch')
        measured_audio = audio_duration(staged)
        require(abs(measured_audio - duration) < 0.05, 'Final audio duration mismatch')
        import shutil
        shutil.copy2(staged, output)
    metadata = {'schema_version': '1.0', 'status': 'RENDERED_REQUIRES_VISUAL_REVIEW',
        'completed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'review_pending': True, 'plan': str(args.plan.resolve()), 'output': str(output),
        'requested_duration_s': plan.get('duration_s', duration), 'video': info,
        'audio': {'codec': 'aac', 'sample_rate': 48000, 'channels': 2,
                  'duration_s': measured_audio,
                  'has_supplied_audio': any(s['_render']['audio_path'] for s in plan['scenes']),
                  'source_video_audio_used': False, 'lip_sync_verified': False},
        'graphics': {'product_id': '1084192893', 'price_krw': 49900,
                     'price_scope': '상의 1종; 하의·신발 별도',
                     'snapshot_date': '2026-09-21', 'disclosure': 'AI 가상인물 · 데모'},
        'composition': {'fit': 'contain, no crop', 'video_region': [0, VIDEO_Y, WIDTH, VIDEO_HEIGHT],
                        'source_video_looped': False, 'source_end_padded': False,
                        'fps_conversion': '24 fps; per-scene motion_interpolation records duplicate/drop or CPU optical flow',
                        'interpolated': any(s['_render']['motion_interpolation'] == 'minterpolate'
                                            for s in plan['scenes']),
                        'interpolation_method': 'FFmpeg minterpolate MCI/AOBMC bidirectional variable-size block motion compensation',
                        'interpolation_visual_review': 'Pending; hands, garment edges and disocclusions may warp',
                        'low_resolution_upscale_used': any(s['_render']['upscaled'] for s in plan['scenes'])},
        'scenes': [{k: v for k, v in scene.items() if k != '_render'} | {'actual': scene['_render']}
                   for scene in plan['scenes']]}
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'metadata': str(metadata_path),
                      'duration_s': info['duration_s'], 'status': metadata['status']},
                     ensure_ascii=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, KeyError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
