# 로컬 SadTalker CPU 환경

공식 저장소: https://github.com/OpenTalker/SadTalker

확인한 commit: `cd4c0465ae0b54a6f85af57f5c65fec9fe23e7f8`.

이 환경은 가상 실사 인물 사진과 준비한 음성으로 짧은 로컬 영상 생성 가능성을 검증하기 위해 설치했다. 환경 설치와 CLI import를 확인했으며, 이 문서 작성 시점의 작업 범위에는 영상 생성 결과가 포함되지 않는다.

## 경로

- Python: `tools-local/venv-sadtalker/bin/python` — Python 3.9.6
- 공식 소스: `tools-local/SadTalker`
- 최소 CPU requirements: `tools-local/requirements-sadtalker-cpu.txt`
- 실제 설치 목록: `tools-local/sadtalker-installed-packages.txt`
- 가중치 다운로드·해시 manifest: `tools-local/sadtalker-model-manifest.json`
- 실행 wrapper: `tools-local/run_sadtalker_cpu.py`
- FFmpeg: `tools-local/bin/ffmpeg`는 imageio-ffmpeg 0.6.0이 제공한 macOS arm64 FFmpeg 7.1 실행 파일을 가리킨다.

## 실행

프로젝트 루트에서 실행하며 미디어·결과 경로는 절대 경로로 지정한다.

```sh
tools-local/venv-sadtalker/bin/python tools-local/run_sadtalker_cpu.py \
  --source_image /absolute/path/portrait.png \
  --driven_audio /absolute/path/short.wav \
  --result_dir /absolute/path/results \
  --size 256 --preprocess crop --batch_size 1
```

Wrapper는 공식 `inference.py`를 CPU 모드로 호출하고 실행 디렉터리·FFmpeg PATH·Torch/Numba/Matplotlib 캐시를 이 작업 폴더로 설정한다. 공식 소스의 추론 알고리즘은 수정하지 않았다.

`crop`은 mapping_00229를 사용한다. `full`은 mapping_00109를 사용하며 원본 어깨·배경에 얼굴을 되붙인다. `--still`은 고개 움직임을 억제하므로 원하는 표현에 따라 별도로 판단한다. 512 모델, 얼굴 복원 GFPGAN 가중치, 배경 업스케일러, 웹 UI, 외부 TTS는 준비하지 않았다. GFPGAN Python 패키지는 공식 CLI의 import 의존성 때문에 설치했다.

## 준비 검증과 한계

- torch 2.0.1 직접 import 성공.
- Wrapper를 통한 공식 CLI `--help` 실행 성공, 종료 코드 0.
- 내려받은 파일은 공식 GitHub Releases 출처와 실제 크기·관측 SHA256을 manifest에 기록한다. 관측 해시는 재현·변경 확인용이며 별도로 게시된 공식 체크섬과 대조했다는 의미는 아니다.
- `pip check`는 torch 2.0.1과 grpcio 1.80.0의 배포 내부 WHEEL 태그가 x86_64로 기재되어 플랫폼 경고를 냈다. 설치 파일은 arm64/universal2 휠로 받았고 torch의 실제 Mach-O 바이너리는 arm64임을 확인했다. 경고를 없애려고 배포 메타데이터를 수정하지 않았다.
- 시스템 Python의 LibreSSL에 대한 urllib3 경고가 있으나 이번 CLI help import는 종료 코드 0이었다.
- macOS 초기 라이브러리 로드와 Matplotlib 폰트 캐시 생성에 시간이 들었다. 실제 영상 생성 속도·한국어 립싱크·메모리 사용량은 짧은 추론으로 별도 확인해야 한다.

의존성은 기존 코드의 NumPy/Pillow/torchvision API를 유지하도록 고정했다. 시스템 Python이나 다른 프로젝트 환경에는 설치하지 않았다.
