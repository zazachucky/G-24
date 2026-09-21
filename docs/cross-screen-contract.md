# 고객 · Director 데이터 연동 계약

2026-09-21. 기존 Size Need·승인·거절·TTL·방송 종료 규칙과 상품 Fixture를 유지한다. 로컬 앱의 주요 고객 행동·공용 안내에 이어 첨부 화면의 공개 댓글·장바구니·다중 관심 집계·개인화 표시·영상 장면 이동을 연결한다. 기능별 범위는 [첨부 화면 보완](experience-extension.md)에 정리한다.

## API 추가 계약

`GET /api/state`의 기존 필드는 유지하고 `integration`을 추가한다. 고객 원문 질문·개인 답변·프로필은 공개하지 않는다. 모든 시간은 서버가 기록한다.

상단 `counts`는 현재 `scope.broadcast_id/product_id`로 한정하며 `events = ui_events + fixture_events`다. `logs`는 실행 전체의 최근 최대 300건으로, 서버 수신 순서 `sequence`와 안전한 행동 상세를 포함한다. 따라서 다른 상품의 이벤트는 기록에는 남되 메인 상품 KPI에 합산하지 않는다. Need 분석 `campaign.evidence.source`는 서버 규칙 집계이며 고정 성과의 `campaign.result.source = Prototype Simulation`과 구분한다.

```text
integration: {
  source: "실제 UI 이용 집계", scope: {broadcast_id, product_id},
  presence: {online_customers, sessions, lease_seconds: 15},
  totals: {events, customers, asks, size_views, benefit_views, styling_views,
           detail_views, purchase_clicks, purchase_completions, media_errors},
  event_counts: {EVENT_TYPE: count},
  intents: [{intent, count}],
  selections: {colors: [{value,count}], sizes: [...], looks: [...]},
  linked_products: [{product_id, count}],
  customers: [{id, online, sessions, events, last_event, last_at,
               selection: {color,size,look}, active_result, media_mode, orientation}],
  recent: [{at,event_type,customer_id,product_id,metadata}],
  response: {pending, completed, fallback, cancelled},
  measured: {approval_at, before: {asks,size_views,purchase_clicks,purchase_completions},
             after: {asks,size_views,purchase_clicks,purchase_completions}},
  notices: [{notice_id,text,route,created_at,active,seen_count,seen_by}],
  comments: [{comment_id,customer_id,text,created_at,received_at}],
  monitor: {
    source: "실제 고객 UI 수신", as_of, time_basis: "server_receive_elapsed_seconds",
    viewers: {online_customers,sessions,unique_visitors}, comments: {total},
    conversion: {completed_customers,visitor_customers,rate_percent},
    trend: {bucket_seconds:60,window_seconds:1800,categories,buckets},
    top_questions: [{topic_id,label,count}],
    insight: {window_seconds:300,category,previous_count,current_count,
              change_percent,status,text,counts},
    actions: {host,app}, outcomes: {approved,approval_at,source,before,after}
  }
}
```

- `totals`·행동 집계는 현재 방송/메인 상품의 실제 UI 이벤트만 포함한다. Fixture 70건·고정 성과 Simulation과 구분한다. `recent`는 최대 50건이다.
- `customers`는 A/B/C 가상 고객의 안전한 사용 상태다. `selections`는 실제 선택 변경 이벤트의 횟수이며 기본값이나 폴링을 선택으로 세지 않는다.
- `intents`는 ASK 분류별 요청 수다. 복합 질문은 지원되는 두 분류에 각각 한 번 포함할 수 있어 합계가 질문 수보다 많다.
- `measured`는 승인 전/후의 누적 이용 건수다. 동일 관찰 기간이 아니며 인과 효과·전환율·매출을 주장하지 않는다. 승인 전후 구분에는 이벤트 수신 순서를 사용한다.
- `response`는 질문 요청 단위다. fallback은 completed의 부분집합이며, 취소된 지연 요청은 cancelled에 포함한다.
- 접속은 가상 도메인 시간이 아닌 단조 wall clock의 15초 lease로 판단한다. 시연 시간이 멈춰도 만료한다.
- `comments`는 명시적으로 공개 게시한 최근 최대 100개다. `monitor.comments.total`은 누적 공개 댓글 수이며 고객 영상에는 최근 3개만 표시한다. ASK 원문을 공개 댓글로 복제하지 않는다.
- 고객 전용 `customer.cart`는 `{item_id,product_id,color,size,quantity,unit_price_krw}` 목록이다. 다른 고객과 Director 공개 응답에는 이 목록을 포함하지 않는다.
- 고객 전용 `customer.profile`은 `{height_cm,usual_size,half_size,fit,garment_chest_cm}`이며 `customer.size_recommendation`은 `{recommended_size,label,reasons,measurements,review,source_refs,source,unavailable_reason?}`다. 프로필 입력값과 개인 추천은 다른 고객·Director에 전달하지 않는다. 실제 구매 선택만 기존 안전한 옵션 상태로 공개한다.

### 모니터 집계의 시간과 분모

`received_at`과 `monitor.as_of`는 해당 실행 시작부터 서버가 실제로 받은 경과초다. 기존 `at`·승인 생성/만료 시각은 도메인 가상 시계다. Demo Control의 시간 진행이나 영상 seek로 트렌드 집계 창을 이동하지 않는다.

- 최근 30분의 ASK 요청을 60초 구간으로 나누고 사이즈·가격/혜택·배송·상품 정보·기타에 집계한다. 한 질문의 같은 분류는 한 번, 서로 다른 분류는 각각 포함할 수 있다.
- TOP 5는 최근 30분의 enum 주제별 건수와 고정 대표 문구다. 자유 입력 원문을 제목으로 공개하지 않는다.
- 인사이트는 최근 5분과 직전 5분을 비교한다. 직전 0건이면 증가율을 만들지 않고 신규 관심으로 표시한다.
- 상단 완료율은 고유 방문 고객 중 구매 체험 완료 고객이다. 분모가 없으면 비율은 `null`이며 실제 결제 전환율이 아니다.
- `outcomes.before/after`는 승인 수신 순서로 나눈 `size_questions`, `detail_views`, `active_customers`, `completed_customers`, `completion_rate_percent`다. 각 구간의 실제 이벤트 참여 고객을 분모로 하므로 상단 누적 방문 분모와 구분한다. 관찰 기간과 고객 구성이 달라 인과 효과를 주장하지 않는다.
- `actions.app.target_count`, `exposed_customers`, `highlighted_customers`는 각각 승인 대상, 실제 표시 확인 고객, 현재 강조 고객이다. TTL이 지나면 현재 강조는 해제되며 과거 표시 확인은 남는다. 기존 고정 성과 카드 3개와 실제 누적 4개 행은 유지한다.

### Action

기존 `{action,run_id,customer_id?}` 구조를 유지한다.

- `presence {customer_id,session_id,status:"active"|"leave"}`: 탭마다 임의 ID, 5초마다 active. 최초 고객 입장만 `LIVE_ENTER` 기록, heartbeat/재조회는 이벤트를 늘리지 않는다. 세션이 고객을 바꾸면 기존 매핑을 대체한다. 종료 후에도 presence는 허용한다.
- `notice_publish {notice_id,text,route:null|"size"|"benefit"|"styling"|"detail"}`: Director 공용 안내, text 최대 500자. 같은 ID/같은 내용은 재시도 중복 방지, 다른 내용 재사용은 409. 상품/개인별 안내가 아닌 이 방송 전체의 공용 메시지다.
- `notice_retract {notice_id}`: 회수 후 모든 고객 메시지에서 제거한다. 기록은 Director에 남긴다.
- `notice_seen {customer_id,notice_id}`: 화면에 실제 메시지가 렌더링된 고객을 한 번만 집계한다. 읽음/이해 여부를 뜻하지 않는다.
- 고객 `messages`에 활성 공용 안내가 `actor=OPERATOR`, `visibility=broadcast`, `notice_id`, `route`와 함께 포함된다. 회수·Reset 시 사라지며 새로고침/늦은 입장에도 보인다. seed 안내는 기존대로 유지한다.
- 기존 `event`에 선택적 `metadata` 객체를 허용한다. 원문 문자열은 금지하고 이벤트별 필드와 Fixture 값만 받는다. `STYLING_PRODUCT_CLICK`: `{product_id}`; `PRODUCT_DETAIL_OPEN`: `{tab}`; `QUICK_ACTION_CLICK`: `{action}`; `MEDIA_ERROR`: `{kind:"video"|"image"}`. 필요 없는 이벤트는 빈 객체다. 같은 event_id에 다른 metadata는 409.
- `comment_publish {comment_id,text}`: 해당 고객이 별도 공개 입력에서 제출한 최대 300자. 실행·고객·ID 기준 재시도 중복 방지, 다른 내용으로 같은 ID 재사용은 거절한다. 화면에는 HTML로 실행하지 않고 글자로 표시한다.
- `cart_add {request_id,color,size,quantity}`: 확인된 품절 아님 옵션만 허용하고 동일 옵션은 합산한다. `cart_update {request_id,item_id,quantity}`는 1~10개 변경, 0은 삭제다. 같은 요청 ID 재시도는 중복 적용하지 않는다.
- `cart_checkout {item_id}`: 고객 UI의 옵션과 `purchase_quantity`를 설정하고 구매 진입을 한 번 기록한다. 완료는 checkout 당시 수량만 차감한다. 다른 탭이 추가한 수량은 보존하며 실제 주문은 생성하지 않는다.
- `profile_update {patch}`: 키 140~200cm 또는 null, 평소 사이즈 55/66/77/88, 반사이즈 boolean, 핏 `regular|relaxed`, 보유 의류 가슴단면 30~80cm 또는 null을 서버에서 검증한다. 유효한 변경만 반영하고 공개 `PROFILE_UPDATE` 이벤트에는 입력값을 넣지 않는다. Reset은 기본 프로필로 되돌린다.
- 공유 성공은 `SHARE_COPY`, 장바구니 열기는 `CART_OPEN`, 전체 코디 보기는 `STYLING_ALL_OPEN`으로 기록한다. 클립보드 실패는 공유 성공으로 세지 않는다. `CART_ADD/UPDATE/REMOVE`와 안전한 옵션·수량 메타데이터는 서버에서 기록한다.
- `PERSONALIZATION_SHOWN {metadata:{approval_id}}`: 실제 보이는 추천 버튼의 표시 확인이다. 서버는 현재 승인·대상을 검증하고 실행·승인·고객 기준으로 중복을 제거한다. 대상 33명에 자동으로 33회 노출을 기록하지 않는다.
- `VIDEO_SCENE_SEEK {metadata:{asset_id,chapter_id}}`: 카탈로그의 자산·검수 장면 조합을 검증한다. 질문 원문·임의 타임코드는 공개 메타데이터에 포함하지 않는다.

### UI 상태 변경의 서버 측 기록

`ui_state` 검증 후 실제 값이 바뀔 때만 기록한다: color/size → `OPTION_SELECT` `{color,size}`; look → `STYLING_LOOK_CHANGE` `{look}`; image_index → `PRODUCT_IMAGE_VIEW` `{image_index}`; orientation → `ORIENTATION_CHANGE` `{orientation}`; media_mode → `MEDIA_MODE_CHANGE` `{media_mode}`; video_paused → `MEDIA_PLAY`/`MEDIA_PAUSE`. `active_result`에서 null로 전환 → `LIVE_RETURN`. `video_time`·volume·muted 저장은 이벤트를 만들지 않는다. 종료 후 수동 탐색은 UI만 저장하고 집계하지 않는다.

클라이언트는 결과 보기·상세 탭·상품 문의·코디 상품·구매·제안 노출/수락/거절·빠른 버튼을 전송한다. 같은 클릭을 클라이언트와 서버가 이중 기록하지 않는다. ASK는 서버 분류를 집계한다. 새로고침은 과거 결과/제안을 중복 집계하지 않는다.

`purchase_quantity`는 1~10 정수이며 일반 구매 진입은 1개, 카트 checkout은 해당 수량을 사용한다. `active_result`의 `cart`·`styling_all`로 새로고침 후 화면을 복원한다. `video_asset_id`와 영상 위치·재생 상태는 고객 UI에 저장한다. 영상 질문 답변의 검수 근거·장면 CTA는 개인 메시지에 포함하며 다른 상품의 참고 영상을 메인 상품 사실로 전환하지 않는다.

LIVE 퇴장은 탭의 고객·상품별 sessionStorage 상태와 해당 탭의 `presence leave`를 사용한다. 같은 고객의 다른 탭이나 전체 방송을 끝내지 않는다. 퇴장한 탭은 재입장 전까지 heartbeat와 재생을 멈춘다.

사이즈 비교는 `main-product.size_guide`의 가슴단면과 판매자 반사이즈 안내를 사용한다. 보유 의류 폭 이상인 최소 옵션을 기준으로 여유 핏을 적용하고, 반사이즈 안내는 평소 사이즈보다 한 단계 큰 옵션을 최소 기준으로 삼는다. 키는 총길이 확인의 참고이며 사이즈 계산에 쓰지 않는다. 가능한 최대 88을 넘는 조건은 `recommended_size=null`과 사유를 반환한다. 리뷰의 1,046/1,202·87%는 상품 전체 집계이며 유사 체형 만족률이 아니다.

## 화면 반영 및 검수

- Director: 실제 이용 카드, 질문 유형, 옵션/코디 변경 분포, 연결 상품 클릭, 고객별 상태, 응답 처리 상태, 최근 행동, 실제 승인 전후 집계, 공용 안내 작성/CTA/회수/표시 고객 수.
- 고객: 공용 안내/CTA, 종료 상태, 승인 추천·거절·만료, 접속 heartbeat. 개인 질문 비공개·영상/도메인 시계 분리를 유지한다.
- 두 화면은 기존 500ms 조회를 사용하며 Reset·새로고침·일시 연결 실패 이후 같은 실행으로 복구한다. 요청 실패를 성공으로 표시하지 않는다.
- 서비스 검사: 중복·잘못된 메타데이터·개인정보·접속 만료·안내 회수·Reset·종료·집계/Fixture 분리·승인 경계.
- 실제 다중 Chrome 페이지: 고객 질문/탐색/선택/코디/구매 → Director 수치·상태, 공용 안내/CTA/회수 → A/B/C, 승인/종료/Reset, 재조회 중복 방지, 연결 복구, 개인 대화 격리.
- 신규 체험: 공개 댓글 A→B/Director와 ASK 비공개, 댓글 최근 100개 이후 누적 수, 카트 고객 격리·응답 유실 재시도·동시 탭 checkout 수량 보존, 실제 표시 확인 중복 방지, 트렌드 5분/30분 경계, 실제 영상 이동·원위치 복귀를 검증한다. [Customer](evidence/customer-experience-verification.json), [Director](evidence/director-experience-verification.json), [영상](evidence/video-experience-verification.json) 보고서를 참고한다.
