# GS AI LIVE — 통합 프로토타입

고객 화면과 Director를 같은 이벤트·상태로 연결한 로컬 데모입니다. 기존 상품·코디 자료와 Python Need 로직을 사용합니다.

```sh
python3 app/server.py
```

- [고객 화면](http://127.0.0.1:8765/app/customer.html) / [Director](http://127.0.0.1:8765/app/director.html)
- [실행·초기화·시연 방법](docs/run-demo.md)
- [검증 결과와 남은 범위](docs/app-verification.md)
- [첨부 화면 기준 기능 보완](docs/experience-extension.md) / [요구사항별 구현 검토](docs/experience-completion-review.md)
- [Director 구좌별 데이터 원천·연동 점검](docs/director-data-audit.md)
- [구현 구조·기술 결정](docs/app-architecture.md)
- [고객 · Director 연동 항목과 집계 기준](docs/cross-screen-contract.md)
- [구현 Goal 명세](docs/GS_AI_LIVE_Goal_Prompt.md)

Python 3.9 이상으로 실행하며 별도 설치·API 키가 필요 없습니다. 두 화면은 서버를 실행한 후 여세요. 고객·혜택·배송·성과는 가상/준비/Simulation으로 구분합니다. 제공 MP4는 다른 상품의 참고 영상입니다. 직접 검수한 7개 구간과 별도 상품 설명 샘플의 대본 12개 장면에서 영상 질문·요약·장면 이동을 지원합니다. 자동 음성 전사는 초안이며 임의 영상 분석은 검증하지 않았습니다.

Director의 **고객 이용**에서 실제 질문 유형·상세 탐색·옵션·코디·구매 체험·미디어 상태를 확인하고, 고객에게 공용 안내를 게시·회수할 수 있습니다. 개인 대화는 해당 고객에게만 보입니다. 실제 이용 집계와 기존 고정 성과 Simulation은 구분합니다.

첨부 Customer·Director 화면의 빠진 기능을 추가하고 **Python 112개, Chrome 311개 검사**를 통과했습니다. 고객의 공유·장바구니·공개 댓글·탭별 퇴장·후기·개인 사이즈 입력과 실측 비교·혜택·코디와 Director의 관심 트렌드·주요 질문·구매 체험 완료율·실제 전후 지표를 연결했습니다. 실제 고객 행동은 공유 상태로 반영하며, 상품 스냅샷·고정 규칙·질문 예시·성과 Simulation은 [구좌별 점검표](docs/director-data-audit.md)에 별도로 명시했습니다.

## 기존 준비 자료

고객 AI와 Director를 연결하는 미결정 규칙을 확정하고 실제 상품·코디 자료를 준비한 패키지입니다.
아래 자료는 기존 데이터·reference·영상 제작 준비 이력입니다. 현재 통합 앱 상태는 위 실행·검증 문서를 기준으로 확인합니다.

- [자료·Lookbook 미리보기](preview/index.html) — 파일을 브라우저에서 열면 됩니다.
- [착용·시연형 홈쇼핑 영상 제작 현황](docs/portrait-shopping-video.md) — 이전 착용·접사·전신 영상 제작 작업 기록.
- [기존 얼굴 중심 10초 시험 MP4](assets/video/home-shopping/gs-ai-live-home-shopping-preview-10s.mp4) — 착용·손 시연 요구를 충족하는 최종 영상이 아님.
- [실제 MP4 재생·구간 이동 테스트](preview/video-test.html) — 2분·1080p·한국어 음성·자막.
- [테스트 영상 MP4](assets/video/test-live/gs-ai-live-test-120s.mp4)
- [테스트 영상 연결 방법](docs/test-video.md) / [영상 AI 검수 사례 10개](docs/video-test-cases.md)
- [갱신된 개발자 인계 문서](requirements/GS_AI_LIVE_Prototype_Developer_Handoff_v1.0.md)
- [해결 기록과 현재 상태](docs/resolution-register.md)
- [고객 Need → Director 규칙](docs/need-director-rules.md)
- [대화·고객 화면 정책](docs/conversation-policy.md)
- [통합 검수표](docs/acceptance-checklist.md)
- [상품 데이터 출처](docs/product-data-sources.md)
- [코디 상품 출처](docs/styling-sources.md)
- [Lookbook 생성 프롬프트·저장 위치](assets/lookbooks/generation.json)
- [쇼호스트 영상 제작 지시서](docs/sample-video-production-brief.md) — 2분 대본·장면별 동작·계획 자막.
- [외부 영상 제작 전달 ZIP](deliverables/gs-ai-live-sample-video-production-kit.zip) — 대본과 필요한 이미지를 함께 전달합니다.

## 준비된 자료

| 자료 | 경로 |
| --- | --- |
| 실제 메인상품·리뷰·사이즈표 | `fixtures/main-product.json` |
| 가상고객·혜택·배송·이미지데모 설정 | `fixtures/demo-config.json` |
| 고객 체험 프로필·추가 조건·댓글·장바구니 정책 | `fixtures/experience-customer.json` |
| 검수 영상 구간·샘플 제작 대본 지식 | `fixtures/video-knowledge.json` |
| ASK LIVE 답변·Direct Result 연결 | `fixtures/ask-live.json` |
| 코디 후보 하의8·신발6 | `fixtures/styling-candidates.json` |
| 확정 코디3종 | `fixtures/styling-looks.json` |
| 가상 이벤트·Director 결과 | `fixtures/director-scenario.json` |
| 실제 상품 이미지 | `assets/products/main/`, `assets/products/styling/` |
| 사전생성AI Lookbook3장 | `assets/lookbooks/` |
| 쇼호스트 영상 제작용 대본·계획 자막·챕터 | `assets/video/sample-live/` |
| 실제 테스트 MP4·음성·자막·챕터 | `assets/video/test-live/` |

기존 준비 패키지의 미디어 기본값은 상품 이미지입니다. 현재 통합 앱은 이 기본 모드와 제공된 코어어센틱 참고 MP4 재생을 함께 지원합니다. 별도 120초 테스트 영상은 상품 이미지·합성 음성·자막을 합친 기능 검증용이며, 이전 가상 실사 진행자 10초 시험본과 미완성 전신 영상 제작 자료는 현재 참고 MP4와 구분합니다. 이번 통합 앱 작업에서는 새 쇼호스트 영상을 생성하지 않았습니다. 현재 영상 기능은 검수된 화면 근거와 제작 대본을 조회하는 로컬 기능이며 외부 영상 이해 모델을 호출하지 않습니다.
혜택·배송·Director성과는 각 라벨에 따라 준비값 또는 시뮬레이션으로 표시합니다.

## 오프라인 검증

Python 3.9 이상, 외부 패키지·API키·네트워크 없이 실행합니다.

```sh
python3 scripts/validate_demo.py --write-report
python3 -m unittest discover -s tests -p 'test_need_director.py' -v
python3 prototype/need_director.py
```

기대 결과: 8→26명(+225%) 감지, 승인 대상33명, 고객A 적용·B/C 미적용.
검증 결과는 [JSON 보고서](docs/verification-report.json)에 기록합니다.
이는 로직·데이터·자산 연결 검증입니다. 실제 앱의 기존 여섯 브라우저 검사 194개와 신규 Customer·Director·영상·사이즈 입력 검사 117개를 독립 서버에서 수행합니다. 같은 서버를 사용하는 검사는 순차 실행합니다. [검증 명령](docs/run-demo.md#검증-명령)을 따르며 결과는 `docs/evidence/`에 기록합니다.
