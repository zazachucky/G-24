# 기능 검증용 2분 MP4

[테스트 영상 MP4](../assets/video/test-live/gs-ai-live-test-120s.mp4)는 실제 상품 이미지, 한국어 합성 음성, 화면 정보 카드와 대사 자막을 합친 파일이다. 실사형 쇼호스트는 포함하지 않는다. 실사형 인물 영상 생성 도구의 연결을 기다리는 동안 영상 입력이 필요한 개발·테스트에 사용한다.

[재생 페이지](../preview/video-test.html)를 브라우저에서 열면 MP4 재생, 장면 이동, 제작 대본 키워드 검색, 재생 위치 북마크를 확인할 수 있다. 별도 서버 없이 로컬 파일로 열 수 있다. 이 페이지의 키워드 검색은 문장에 포함된 단어를 찾는 기능이며 AI 의미 검색 결과가 아니다.

## 파일과 용도

| 파일 | 용도 |
| --- | --- |
| `assets/video/test-live/gs-ai-live-test-120s.mp4` | 120초, 1920×1080, 24fps, H.264 영상 + AAC 음성. 대사 자막 포함 |
| `assets/video/test-live/narration.wav` | MP4에 삽입한 120초 한국어 음성 타임라인 |
| `assets/video/test-live/subtitles.ko.srt`, `subtitles.ko.vtt` | 음성 클립 배치 시각에 맞춘 대사 자막 |
| `assets/video/test-live/chapters.ko.vtt` | 10초 간격의 12개 챕터 |
| `assets/video/test-live/reference-transcript.json` | 평가용 정답 대본과 실제 삽입한 음성 클립 길이. ASR 결과 아님 |
| `assets/video/test-live/render-plan.json` | 영상에 사용한 이미지·문구·표시 시각·출처 |
| `assets/video/test-live/gs-ai-live-test-120s.metadata.json` | 완성 MP4의 길이·해상도·fps·코덱 검증 결과 |
| `assets/video/test-live/browser-verification.json` | 실제 브라우저 재생·seek·참고용 플레이어 검사 결과 |
| `fixtures/video-test-cases.json` | ASR·요약·장면 검색 등을 위한 평가 입력과 기대값 |

## 개발에 연결하는 방법

개발 서버에서 MP4를 정적 파일로 제공하고 비디오 플레이어의 `src`로 지정한다. MIME은 `video/mp4`다. 구간 이동을 위해 서버가 바이트 범위 요청을 처리하도록 하고, 앱의 실제 `currentTime`을 검색 결과의 시작 시각으로 설정한다.

대표 구간은 소재 10초, 두께 리뷰 30초, 66 실측 40초, 추천·품절 50초, 출근 코디 60초, 가격 90초, 배송 100초다. 자막은 MP4에 이미 포함되어 있다. 별도 SRT/VTT는 파싱·타임라인 검증용으로 제공하며 플레이어에 중복 표시하지 않는다.

음성 인식에는 MP4에서 추출한 음성을 입력하고 `reference-transcript.json`은 결과 평가에만 사용한다. 영상 요약·의미 검색도 실제 모델을 연결해 실행한 뒤 [검수 사례](video-test-cases.md)와 비교한다. 영상 파일이 준비되었다는 사실만으로 영상 AI가 구현되거나 검증된 것은 아니다.

기존 `fixtures/demo-config.json`의 기본 미디어 모드는 상품 이미지로 유지한다. `media.test_video`에서 테스트 MP4를 참조할 수 있다. 실제 고객 앱과 Director 화면은 이 파일만으로 구현되지 않는다.

## 제작과 재현

음성은 macOS Yuna를 사용했다. 숫자와 금액의 읽기를 한글로 정리한 12개 음성 클립을 각 장면 시작 후 0.45초에 넣고, 10초 장면이 끝나기 전까지 재생하도록 배치했다. 전체 120초 중 약 90.2초가 클립 분량이며 나머지는 장면별 설명 전후의 여유다.

이미지는 확보한 원본 비율로 배치한다. AI 코디·가상 혜택·배송 시뮬레이션 표시와 2026.09.21의 상품 정보 확인일을 유지한다. 별도의 입모양·인물 동작 생성은 없다.

렌더러는 `scripts/render_test_video.swift`다. macOS의 시스템 미디어 인코더를 사용하며 ffmpeg나 외부 영상 API가 필요하지 않다. 동일 파일을 덮어쓰지 않으므로 재생성 시 새 MP4 경로를 지정한다.

```sh
xcrun swiftc -parse-as-library -O -module-cache-path /tmp/gs-ai-swift-module-cache scripts/render_test_video.swift -o /tmp/render_test_video
```

실행 인수는 워크스페이스 절대 경로, `render-plan.json` 절대 경로, 새 출력 MP4 절대 경로 순서다. 현재 실행 환경에서는 시스템 인코더 접근에 별도 실행 승인이 필요했다.

실사형 쇼호스트 영상이 연결되면 MP4와 실제 자막·챕터를 교체하고 해당 영상으로 AI 검수를 다시 실행한다. 이 테스트 영상으로 쇼호스트의 입모양, 인물 일관성, 실제 제스처 인식 품질을 판정하지 않는다.
