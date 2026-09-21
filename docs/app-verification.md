# GS AI LIVE 통합 앱 검수 결과

최신 후속 변경: 코디 탭의 큰 AI 전신 이미지와 오른쪽 상의·하의·신발 상품 사진을 분리했습니다. 관련 Chrome 164개(모바일 54 + 고객 51 + 통합 59)를 재실행해 통과했고, [후속 검수](evidence/styling-products-verification.json)에 현재 소스와 기본 서버 제공 파일 일치를 기록했습니다. 아래 113개·359개 완료 기록은 배치 수정 전 모바일 작업의 검수 이력입니다.

2026-09-21. 최신 고객용 모바일 요구에 맞춰 색상·코디 우선순위·세로/가로 배치·ASK 진행 표시·선제 제안을 개선하고 **Python 113개와 실제 Chrome 359개 PASS**를 확인했다. Chrome 검사는 이번 모바일 전용 48개와 새 코드에서 다시 실행한 기존 통합 검사 311개다. [모바일 요구사항별 검수](mobile-customer-goal-review.md)와 [사용·구현 범위](mobile-customer-guide.md)를 최신 고객 화면 기준으로 사용한다. 영상 기능은 검수한 화면 7개 구간과 샘플 제작 대본 12개 장면의 제한된 조회·요약·탐색으로 확인했다. 외부 영상 이해 모델이나 임의 영상 분석의 성능을 검증한 것이 아니며, 기존 reference 테스트 결과를 UI 결과로 대신하지 않았다.

| 검증 | 결과 | 실제 증거 |
| --- | --- | --- |
| 상품·이미지·리뷰·코디 Fixture 검증 | PASS | [기존 데이터 보고서](verification-report.json) |
| Python 단위·서비스·HTTP 검사 | 113개 PASS | [실행 출력](evidence/mobile-customer-unit-output.txt) |
| 최신 모바일 디자인·방향 전환·코디·사이즈·혜택·ASK·선제 제안 | 48개 PASS | [모바일 보고서](evidence/mobile-customer-goal-verification.json) |
| 실제 고객/Director 브라우저 통합·미디어 | 59개 확인 PASS | [브라우저 보고서](evidence/browser-verification.json) |
| 고객 전환 경합·CTA·실패·강조 해제 | 12개 확인 PASS | [맥락 전환 보고서](evidence/customer-context-verification.json) |
| 고객 행동·공용 안내·접속·실제 성과 연동 | 31개 확인 PASS | [양방향 연동 보고서](evidence/cross-screen-verification.json) |
| 기본 모니터의 연결된 고객 표 | 25개 확인 PASS | [연결된 고객 보고서](evidence/connected-customers-verification.json) |
| 응답 유실·고객 전환·저장 화면 복원 | 21개 확인 PASS | [연동 예외 보고서](evidence/integration-edge-verification.json) |
| 모니터링·고객 이용·기록·효과 분석 전체 구좌 | 46개 확인 PASS | [구좌별 보고서](evidence/dashboard-slots-verification.json), [데이터 원천·한계 점검표](director-data-audit.md) |
| 첨부 Customer 화면의 누락 기능·동시 탭·재시도 | 50개 확인 PASS | [Customer 기능 보고서](evidence/customer-experience-verification.json) |
| Director 트렌드·TOP 5·실제 완료율·전후 지표 | 21개 확인 PASS | [Director 기능 보고서](evidence/director-experience-verification.json) |
| 검수 장면 질문·요약·실제 MP4 이동·복귀 | 24개 확인 PASS | [영상 기능 보고서](evidence/video-experience-verification.json) |
| 개인 사이즈 입력·실측 비교·개인정보 격리 | 22개 확인 PASS | [사이즈 입력 보고서](evidence/size-profile-verification.json) |
| Reset부터 승인·결과·만료까지 반복 | 3회 연속 PASS | 브라우저 보고서의 서로 다른 `runs[].run_id` |
| HTML/문서/MP4 원본 식별·복사 | 기록된 크기·SHA-256 일치 | [자산 등록](../requirements/reference/asset-register.json) |

Chrome 359개는 기존 6종 194개(59+12+31+25+21+46), Customer 50개·Director 21개·영상 24개·사이즈 입력 22개, 신규 모바일 48개의 합계다. 기존 311개도 2026-09-21 10:54 UTC 이후 수정 코드에서 다시 실행했다. 3회 정상 시연은 59개 통합 검사에 포함된다. 이전 112개·311개 완료 감사는 당시 이력이며 이번 모바일 디자인·행동 조건을 대신 증명하지 않는다.

기본 8765 서버를 최신 코드로 재시작하고 **2026-09-21 10:58:24 UTC**에 실제 실행을 확인했다. 새 RUN `c8fc3743a5234f349a4cb9fbf72df086`에서 390×844 세로·844×390 가로 고객 화면의 16:9 영상, 코디·입력·구매 가림 없음, Director 네 화면의 같은 RUN 연결과 가로 넘침 없음을 확인했다. 브라우저 예외·HTTP 오류가 없고 실제 제공 HTML/CSS/JS 해시도 로컬 최종 파일과 일치했다. 이전 메모리 시연 기록은 초기화했다. [현재 실행](evidence/mobile-customer-live-runtime.json), [최종 코드·검사 감사](evidence/mobile-customer-completion-audit.json)를 현재 적용 근거로 사용한다.

모바일 요청의 사이즈 관심 조건은 **30초 안의 별도 사이즈 행동 2건**이다. 같은 종류를 다시 수행해도 포함하며 동일 event_id 재전송은 제외한다. 이전 문서의 서로 다른 2종 제한을 대체했고, 정확히 30초 경계·고객/상품/방송 분리·중복 제거·한 고객의 반복으로 집단 급증 불가를 도메인 검사에서 확인했다.

검증 명령과 재실행 방법은 [실행·시연 안내](run-demo.md)를 참조한다. 독립 검사 서버를 사용하며 같은 서버의 데모 상태를 사용하는 브라우저 검사는 순차 실행한다.

## 이전 요청: 첨부 화면에서 빠진 기능 추가

고객 화면에는 상품 링크 공유와 직접 복사 대체, 고객별 장바구니, 해당 탭의 LIVE 퇴장/재입장, 별도 공개 댓글, ASK 안의 실제 리뷰 막대, 결과 내 사이즈 선택과 개인 입력·실측 비교·집계 근거, 혜택 조건, 코디 썸네일과 전체 7개 상품을 추가했다. 기존 49,900원·45,515원·기본 추천 66·그레이 66 품절·리뷰 99% 원본 합계를 유지했다. 없는 체형 정보나 가상의 개별 후기를 만들지 않았다.

개인 사이즈 검수는 키만으로 추천을 바꾸지 않음, 반사이즈 66→77, 보유 의류 46.8cm와 실제 47.5cm 옵션 비교, 여유 핏 조건, 범위 밖의 추천 없음, 입력값의 고객 간 격리·새로고침 보존·지연 저장 경합·Reset을 포함한다. 추천 77과 수동 구매 옵션 55가 별도로 유지되는지도 확인했다. 입력·규칙·사유를 표시하는 비교 기능이며 신체 측정이나 개인 맞음새 예측을 보장하지 않는다.

Director에는 실제 시청 고객·탭·누적 방문, 공개 댓글, 구매 체험 완료율, 5개 관심 분류의 최근 30분 트렌드, 주요 질문 TOP 5, 최근/직전 5분 인사이트, 전달·승인·실제 표시 확인, 사이즈 질문·상세 조회·완료율의 승인 전후 지표를 추가했다. 수신 경과초와 기존 Need 가상 시계를 분리하고 원문 개인 질문은 공개하지 않는다.

영상 질문은 참고 MP4의 직접 확인한 7개 장면과 상품 설명 샘플 대본 12개 장면을 자산별로 조회한다. 실제 재생 위치 이동·이전 영상과 위치 복귀·고객 전환·근거 없는 답변 거절을 검증했다. ASR 결과는 초안으로 보존하며 답변 사실 근거에 자동 채택하지 않는다.

장바구니 checkout 2개 후 다른 탭이 3개로 늘리면 완료 후 1개가 남는 경합, 응답 유실 재시도의 중복 방지, 최근 댓글 100개 제한 이후에도 누적 101건 표시, 실제 개인화 표시 확인의 새로고침 중복 방지도 확인했다. [기능별 설명](experience-extension.md)과 [요구사항별 검토](experience-completion-review.md)에 데이터 경계·검사 근거를 연결했다.

확장 화면 증거: [고객 LIVE](evidence/customer-experience-live-mobile.png), [사이즈](evidence/customer-experience-size-mobile.png), [개인 사이즈 비교](evidence/size-profile-personalized.png), [사이즈 입력 모바일](evidence/size-profile-mobile.png), [혜택](evidence/customer-experience-benefit-mobile.png), [전체 코디 상품](evidence/customer-experience-styling-all-mobile.png), [Director 모니터](evidence/director-experience-desktop.png), [실제 효과 분석](evidence/director-experience-analytics.png), [참고 영상 답변](evidence/video-experience-reference-answer.png), [샘플 대본 답변](evidence/video-experience-sample-answer.png).

## 이전 별도 요청: 실시간 모니터링부터 효과 분석까지 전수 점검

사용자 요청에 따라 실제 고객 A/B/C의 조작, 공개 API, Director의 네 화면을 대조했다. 상세 구좌별 원천과 실제 값·고정값의 구분은 [Director 데이터 점검표](director-data-audit.md)에 기록한다.

1. 상단 메인 상품 KPI에 다른 상품의 행동·Need가 섞이던 범위를 현재 방송·상품으로 제한했다.
2. 고정 시연 시계에서 동일한 JSON으로 재연결해도 접속 요약과 두 고객 표가 ‘확인 중’에서 복구되도록 수정했다.
3. 액션 기록 배지와 목록의 건수를 맞추고, 고객·옵션·분석·승인·시계 진행 상세 및 출처를 표시했다.
4. 같은 가상 시각의 기록도 서버 수신 순서의 역순으로 표시했다.
5. 고정 Simulation 공개 전에도 실제 효과 분석 표로 진입할 수 있게 했다.
6. 고정 성과 공개에 `Show Result`가 필요함을 안내하고, 차트의 60초 분석 주기·고정 근거·가상 고객 3명과 급증 최소 10명 조건을 설명했다.

신규 46개 검사는 실제 행동 장부를 기준으로 공통 KPI, 실제 이용 카드 10개, 질문·응답 상태·선택 분포·연결 SKU·안내, 기록 상세·순서, 실제 승인 전후 4개 지표, 고정 성과 카드 3개를 확인했다. 실제 UI 감지 후 차트 0→1 반영, 다른 상품 제외, 개인 질문 격리, 네 화면의 연결 실패·동일 상태 복구도 포함한다. 고정 성과값 26→11 / 14→43 / 82→95는 고객 행동으로 계산하지 않는 기존 Simulation으로 유지했다.

전체 페이지 화면 증거: [모니터링](evidence/dashboard-slots-monitor.png), [고객 이용·안내](evidence/dashboard-slots-activity.png), [액션 기록](evidence/dashboard-slots-history.png), [효과 분석](evidence/dashboard-slots-analytics.png).

## 이전 후속 수정 이력: 기본 모니터의 연결된 고객 화면

사용자가 “연결된 고객화면 연동 안된거 같은데?”라고 지적한 경로를 재현했다. 서버와 별도 ‘고객 이용·안내’ 화면에는 행동이 반영되었지만, 기본 모니터의 ‘연결된 고객 화면’ 표는 Need·승인·강조만 읽어 일반 이용을 표시하지 않았다. 이전 31개 연동 검사는 별도 이용 화면의 수치를 확인하여 이 표의 누락을 발견하지 못했다.

같은 표에서 실제 접속/탭 수, 현재 화면, 색상·사이즈·코디, 영상/방향, 최근 행동·이용 건수를 표시하도록 수정했다. Need·승인 열을 유지하고 단순 사이즈 버튼 이용과 두 신호에 의한 Need 감지를 설명한다. Director 연결이 끊기면 접속을 ‘확인 중’으로 바꾸며, 고객이 퇴장하면 미접속과 마지막 수신 상태를 구분한다.

당시 수정된 기본 모니터를 직접 대상으로 실제 Chrome **25개 후속 검사 PASS**: [결과](evidence/connected-customers-verification.json), [데스크톱](evidence/connected-customers-monitor.png), [모바일](evidence/connected-customers-mobile.png). 다중 탭·퇴장·연결 실패/복구·개인 질문 격리·기존 승인도 확인했다. 당시 사용자 8765 서버와 실행 기록은 초기화하지 않았고 독립 8773 서버에서 검사했다. 당시 검사는 전체 재실행이 아니었으며, 위 최신 전수 점검에서는 이 25개를 포함한 전체 검사를 다시 통과했다.

## 이전 양방향 연동 Goal 완료 근거

추가 요구 “고객 화면과 Director 화면간의 데이터 연동도 다 추가해줘”를 로컬 앱의 모든 주요 행동·운영 제어에 적용했다. [연동 계약](cross-screen-contract.md)과 아래 항목으로 당시 Goal 완료를 확인했다. 당시 추가한 Python 17개 검사는 집계·개인정보·경계 조건을, Chrome 52개 추가 확인은 실제 화면 간 전달과 실패 경로를 검증했다. 기존 71개 브라우저 검사와 3회 시연도 당시 구현에서 다시 통과했다. 현재 코드의 최신 전체 결과는 문서 상단의 검수 단계와 증거를 기준으로 한다.

| 연동 요구 | 현재 동작과 증거 |
| --- | --- |
| 고객 질문 → Director | 실제 ASK 요청·복합 질문 유형·처리 중/완료/대체/취소 집계. 원문·개인 답변은 A/B/C와 Director 사이 격리 검사 |
| 탐색·옵션·코디·구매 → Director | 상세/사이즈/리뷰/문의, 결과 보기, 색상/사이즈/Look 변경, 실제 연결 SKU, 구매 진입/체험 완료를 수신. 10개 카드의 실제 DOM 값과 서버 수치 일치 확인 |
| 제안·미디어 → Director | 제안 노출/수락/거절, 이미지 넘김, 화면 방향, 영상 모드/재생/정지/오류 연결. 미디어 재생과 가상 시계 분리 회귀 검사 |
| 현재 고객 상태 | 접속 인원/탭 수, 현재 선택/화면/미디어, 최근 행동 표시. 15초 wall-clock 접속 만료·복구 검사. 구매/상세/안내/완료 화면 고객 전환 복원 검사 |
| 공용 안내 → 고객 | Director 실제 문구/버튼 입력 → A/B/C 공용 메시지, 늦은 입장, CTA 정보 이동, 표시 고객 수, 회수 시 전 화면 제거 확인 |
| 승인·종료·초기화 → 고객 | A 추천 강조·B/C 미적용, TTL/거절/상품 전환/종료 해제, Reset의 안내/대화/선택/집계 제거와 열린 고객 재접속 검사 |
| 실제 승인 전후 측정 | 서버 수신 순서로 질문/사이즈/구매/완료 분리. 같은 가상 시각의 경계 검사와 Director DOM 수치 일치. Fixture 70건과 고정 -58/+207/+16% Simulation은 별도 유지 |
| 재시도·오류·경합 | 안내 서버 처리 후 응답 유실 → 같은 ID 재시도로 1건 유지. 실패한 거절/게시 성공 오표시 없음. 지연 수락 후 고객 변경·Reset에도 잘못된 결과/집계 없음 |
| 중복 방지 | 폴링·heartbeat·같은 옵션·새로고침·화면 복원·동일 이벤트/안내 ID 재시도가 이용 횟수를 늘리지 않음 |

연동 화면: [Director 실제 이용](evidence/integration-activity.png), [공용 안내를 받은 고객](evidence/integration-customer-notice.png), [실제 측정과 Simulation](evidence/integration-analytics.png), [모바일 Director](evidence/integration-director-mobile.png).

당시 검사 중에는 8771/8772의 별도 서버를 사용했고, 검증 후 기본 8765 서버를 당시 코드로 재시작하여 두 페이지와 연동 API의 HTTP 200을 확인했다. 새 실행에서 메모리 상태는 초기화했다. 그 Goal의 코드·증거 해시는 [이전 완료 감사](evidence/completion-audit.json)에 기록되어 있으며 이번 구좌 전수 점검의 서버 반영 증거를 대신하지 않는다.

## 요구사항별 근거

| 요구사항/기존 검수 ID | 확인한 동작 | 근거 범위 |
| --- | --- | --- |
| C01, C03~C07 | 49,900원·리뷰 1,200·문항 1,202·99% 보존·실측 8항목·일시품절·45,515원·배송 Mock·구매 체험 | 실제 UI와 Fixture 비교 |
| C02, UI-01 | 방향 전환 후 대화·옵션·Look·이미지 위치 유지, 요청 중 전환, 시트 닫기/복귀 | 브라우저 UI + 공통 UI 상태 서비스 검사 |
| C08 | 공용 운영자/개인 질문·답변 격리, Director에 개인 대화 없음 | A/B/C 별도 페이지 및 API payload 확인 |
| S01~S02 | 3 Look 각각 실제 하의·신발 링크와 로드 이미지, Lookbook 실패 시 실제 카드 유지 | 브라우저 UI·실제 이미지 오류 주입 |
| D01, UI-03 | 실제 사이즈표·리뷰 클릭으로 Need 감지, 별도 Director 페이지에 반영, 수락 후 결과 | 실제 UI 이벤트 → 서버 → 다른 페이지 |
| D02 | 중복 ID·내용 충돌·같은 신호 반복·고객/상품/방송 분리·30초 포함 경계 | 실제 앱이 사용하는 도메인/서비스 테스트 |
| D03 | 준비 이벤트도 동일 엔진을 통과해 8→26명(+225%) | 브라우저 Demo Control + 서버 evidence |
| D04~D05 | 승인 전 미강조, 121초 33명 고정, A 포함·B/C 제외, 팝업 강제 이동 없음 | 3회 별도 고객 페이지의 실제 버튼 상태 |
| D06 | 421초 만료, 거절·상품 전환·종료 우선, 복귀 후 미복구, 수동 사이즈 허용 | 브라우저 및 서비스 검사; 재승인 고정·정확한 TTL 경계는 서비스 검사 |
| D07 | 쇼호스트 문구 검토·확인 후 로컬 완료, APP 미승인 유지 | 실제 확인 dialog·버튼 + 공통 상태 |
| D08 | 151초 Simulation, 26→11/14→43/82→95와 -58/+207/+16% | 3회 브라우저 결과 화면·서버 result |
| F01 | 5초 지연 및 응답 오류 시 같은 Intent 준비 답변, 중복 응답 없음 | 실제 ASK UI + 서버 지연 어댑터; 외부 모델 호출 아님 |
| F02 | Reset 후 대화·승인·감지·결과·지연 요청 제거, 이전 run 요청 거절 | 브라우저 Reset 및 서비스 테스트 |
| 추가 맥락 검수 | 늦은 B 응답이 C 화면에 표시되지 않음, 닫은 과거 결과 재개방/중복 이벤트 없음, 상품 변경 시 pending 취소 | 실제 HTTP 응답의 전달 지연을 주입한 브라우저 검사 |
| UI-04 | 좁은 화면 넘침 없음, Escape로 dialog 닫기·포커스 복귀, native 키보드 가능한 컨트롤·상태 알림 | 390px/데스크톱 브라우저, DOM·CSS 확인 |

## 3회 시연의 완료 기준

모든 회차에서 실제 Director의 Reset → Start Need Demo → Spike → APP 승인 → Show Result → 만료 버튼을 사용했다. 고객 A의 수락과 결과 닫기도 실제 UI로 실행했다. 첫 회차에는 쇼호스트 Action을 먼저 실행해 APP 승인과 독립임을 확인했다.

| 시각 | 결과 |
| --- | --- |
| 68초 | A 선제 제안, C 거절, 수동 기능 유지 |
| 120초 | 직전 8명 → 현재 26명, +225%, ALERT |
| 121초 | 33명 승인 snapshot, A 추천 강조, B/C 미적용 |
| 151초 | 고정 Simulation 결과, 실제 측정 성과로 표시하지 않음 |
| 421초 | 승인 강조 만료 |

## MP4 검수

- 원본: 코어어센틱 가디건 영상. 메인 상품 SJ와니 풀오버와 불일치함을 화면에 표시한다.
- 실제 브라우저 duration: 약 57.897초, 720×1280, `object-fit: contain`.
- 영상 프레임과 음성 디코딩 바이트가 증가하고 재생·일시정지·음소거/음량·탐색·종료·다시 재생이 동작한다.
- 가로 전환과 결과 시트 열기/닫기 후 위치·정지·음량·음소거 상태를 유지한다.
- 영상 종료·되감기로 서버 시계와 run이 변하지 않는다. 57.9초 영상과 421초 도메인 시연을 구분한다.
- 존재하지 않는 MP4 경로를 실제로 요청해 오류 안내·이미지 대체·비영상 ASK 유지까지 검사했다. 브라우저 미디어 오류 코드는 고객 진단 API `gsApp.getMediaErrors()`에 기록한다.
- [미디어 manifest](../assets/video/reference/manifest.json)에 원본 해시와 앱 재생 상태를 기록했다. 전체 영상/음성 스트림의 FFmpeg 디코딩도 성공했다.

음성 검수 범위는 파일/브라우저 디코딩 및 음량 제어다. 물리 스피커 청취, 실제 휴대폰과 다른 브라우저, 실제 기기 간 네트워크 시연은 이번 검수 범위에 포함하지 않는다.

## 화면 증거

- [고객 세로](evidence/customer-portrait.png), [모바일](evidence/customer-mobile.png), [가로](evidence/customer-landscape.png)
- [코디](evidence/customer-styling.png), [승인 후 고객](evidence/customer-approved.png), [참고 영상 재생](evidence/customer-reference-video.png)
- [실제 UI 신호를 받은 Director](evidence/director-ui-signal.png), [ALERT](evidence/director-alert.png), [결과](evidence/director-result.png), [좁은 Director](evidence/director-mobile.png)

## 남은 TODO와 범위

영상 검색·요약·Catch-up·영상 기반 ASK LIVE는 검수된 참고 화면 7개 구간과 샘플 제작 대본 12개 장면에서 지원한다. 참고 영상 ASR은 초안이며, 임의 영상·실시간 방송 전체의 자동 전사 정확도와 일반적 영상 이해는 미검증이다. 확인 구간 밖의 발화·착용 사이즈·함량·타임코드는 생성하지 않는다. [영상 검수 기록](../assets/video/reference/transcript-review.json)과 [실제 재생·질문 검사](evidence/video-experience-verification.json)를 함께 확인한다.

외부 LLM, 운영 인증, DB 영속 저장, 다중 기기 연결, 실제 주문·결제·배송·쇼호스트 메시지·자막 송출·운영 배포는 현재 Goal 밖이다. 새 쇼호스트 영상을 제작하거나 이전 영상 생성 작업을 재개하지 않았다. 기존 120초 테스트 영상과 이전 영상 제작 자료는 보존했다.
