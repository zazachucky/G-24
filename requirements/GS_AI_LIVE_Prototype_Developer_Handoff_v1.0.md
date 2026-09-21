# GS AI LIVE
## Prototype Development Kickoff v1.0

> **참고 데이터**: [GS SHOP 상품 1084192893](https://m.gsshop.com/prd/prd.gs?prdid=1084192893). 원본별 사용 범위·로컬 Fixture·적용 순서는 §34.3을 참조한다.

### 0. 개발 목표

이번 Prototype의 목표는 기능을 많이 만드는 것이 아니라,

Customer AI
→ Customer Signal
→ Need Detection
→ AI Director
→ PD Action
→ Customer Experience
→ Result

가 하나의 흐름으로 안정적으로 동작한다는 것을 보여주는 것입니다.

발표 중 오류 없이 동작하는 것을 최우선으로 합니다.

기능 추가보다 아래 P0 Flow 완성을 우선해주세요.

---

# 1. 핵심 서비스 구조

GS AI LIVE에는 크게 두 개의 사용자 경험이 있습니다.

## Customer

LIVE 방송을 보면서 AI가 고객별 구매 판단을 지원합니다.

주요 기능:

- ASK LIVE
- 내 사이즈
- 내 혜택
- 코디 추천
- 상품상세 연결
- 고객 행동 기반 선제 제안

## Director

여러 고객의 행동을 AI가 집계하여
현재 어떤 구매 Need가 증가하고 있는지 PD에게 알려줍니다.

Flow:

NORMAL
→ ALERT
→ ACTION
→ RESULT

이번 Prototype의 Director 핵심 Scenario는

`사이즈 관련 Need 급증`

하나를 완성도 있게 구현합니다.

---

# 2. Customer 기본 화면

## Portrait Mobile

Default 화면입니다.

상단:
16:9 가로 LIVE 영상

중단:
상품명
가격
주요 옵션
상품상세
구매하기

Conversation:
운영자 메시지
고객 메시지
ASK LIVE

Quick Question:
상품후기
두께감
색상
배송예상일정 등

Quick Action:
내 사이즈
코디 추천
내 혜택

자유질문:
`궁금한 것을 물어보세요`

---

# 3. Landscape Mobile

Portrait 화면의

`확장해서 보기`

버튼을 클릭하면 Landscape 화면으로 전환합니다.

OS 자동 회전에 의존하지 않습니다.

Landscape에서는:

- LIVE 영상을 크게 표시
- 우측 Conversation 유지
- 운영자 / 고객 / ASK LIVE 유지
- 질문 Input 유지
- 상품정보 / 구매 CTA 유지
- 내 사이즈 / 코디 추천 / 내 혜택 접근 가능

Portrait와 Landscape는 동일한 Conversation State를 공유해야 합니다.

---

# 4. Conversation 원칙

운영자 채팅과 ASK LIVE를 별도 채팅방으로 분리하지 않습니다.

하나의 Conversation Timeline 안에서 표시합니다.

Actor는 반드시 구분합니다.

CUSTOMER
OPERATOR
ASK LIVE
SYSTEM

Example:

CUSTOMER
"이 상품 두께감 어때요?"

ASK LIVE
"구매 고객의 선택형 평가에서는
63%가 얇아요,
35%가 적당해요,
2%가 두꺼워요라고 답했어요."

OPERATOR
"현재 모델이 착용한 컬러는 그레이입니다."

---

# 5. AI UI Routing

모든 AI 기능을 Chat으로 만들지 않습니다.

## Direct Result

내 사이즈
내 혜택
코디 추천

## ASK LIVE

상품후기
두께
색상
배송
영상 기반 질문 중 검증된 Intent

## Existing Commerce UI

상세설명
사이즈
리뷰
상품문의
혜택 상세
구매

---

# 6. Demo Customer

Prototype Persona:

Name:
김지수

Gender:
Female

Membership:
VIP

Payment:
GS Pay

Usual Top Size:
66

Default Address:
서울특별시 영등포구 선유로 75 1층

Customer UI에서 주소를 표시할 경우
전체 주소가 아닌

`서울 영등포구`

수준으로 노출합니다.

Fashion Preference:

Primary:
OFFICE

Secondary:
DATE
CASUAL_COMFORT

Preferred Colors:
GRAY
BLACK

단, Color Preference는 Soft Preference입니다.

코디 추천이 Gray / Black에만 고정되지 않도록 합니다.

---

# 7. Working Product

Product ID:
1084192893

Product:
SJ와니 샤이니 크리즈 캐시미어 풀오버 1종

Current Price:
49,900원

Sizes:
55 / 66 / 77 / 88

Rating:
4.5

Review Count:
1,200

Shipping:
무료배송

---

# 8. Actual Review Data

2026-09-21 공개 리뷰 API로 아래 5개 항목을 재확인했습니다.
[리뷰 원본 집계](https://m.gsshop.com/product/api/revw/v0/reviewMain/1084192893?mseq=397078&prsnInclYn=Y&prsnFilterYn=N)

전체 리뷰 1,200건과 선택형 응답 합계 1,202건의 차이를 원본대로 보존합니다.
두께 답변에는 `구매자 리뷰 기준`을 표시합니다.

Design

좋아요 68%
보통이에요 31%
별로예요 1%

Size

잘 맞아요 87%
작아요 7%
커요 6%

Color

동일해요 91%
생각보다 어두워요 6%
생각보다 밝아요 2%

Thickness

얇아요 63%
적당해요 35%
두꺼워요 2%

Fit

보통이에요 68%
슬림핏이에요 30%
오버핏이에요 1%

반올림으로 합계가 99%인 항목은
원본 값을 그대로 사용합니다.

100%로 임의 보정하지 않습니다.

---

# 9. Benefit Result

Base Price:
49,900원

VIP 5% Discount:
-2,495원

VIP GS Pay Discount:
-1,890원

Total Discount:
-4,385원

Final Price:
45,515원

내 혜택 Result의 핵심 값:

`45,515원`

---

# 10. Size Result

Input:

Customer usual size:
66

Product sizes:
55 / 66 / 77 / 88

Review:
87% 잘 맞아요

Product Guidance:
반사이즈에 걸치는 경우 한 사이즈 크게 권장

Prototype Output:

"지수님은 평소 66 사이즈를 선택하시네요."

"사이즈 평가에서는 87%가
'잘 맞아요'라고 답했어요."

"66 사이즈를 먼저 확인해보세요."

Actions:

사이즈표 자세히 보기
→ Product Detail Size Tab

66 선택하고 구매하기

실제 페이지의 그레이 66은 확인 시점 일시품절입니다. 추천 사이즈는 유지하되
선택 후 화면에 해당 상태와 `구매 시뮬레이션`을 표시하고 실제 주문은 생성하지 않습니다.

Video 기반 모델 착용정보가 검증되기 전에는
정밀 체형 추천처럼 단정하지 않습니다.

---

# 11. ASK LIVE P0 Intent

Prototype에서는 모든 자유질문을 지원하려고 하지 않습니다.

결과가 안정적으로 나오는 Intent를 먼저 구현합니다.

P0:

PRODUCT_REVIEW
PRODUCT_THICKNESS
PRODUCT_COLOR
DELIVERY

Example:

두께감 어때?

→ 리뷰 데이터를 이용해 즉시 답변

색상이 화면과 비슷해?

→ 동일해요 91% 데이터 활용

상품후기 알려줘

→ 실제 리뷰 데이터 요약

오늘 주문하면 언제 와?

→ Mock 배송정보 사용

고정 응답: "배송 시뮬레이션 기준으로 주문 후 2~3영업일 내 도착 예정이에요.
상품 페이지에는 무료배송으로 안내되어 있어요. 실제 도착일은 주문 단계에서 확인해주세요."

---

# 12. ASK LIVE Processing UI

LLM Chain of Thought를 노출하지 않습니다.

사용자에게는 Processing Status만 보여줍니다.

Example:

구매후기를 확인하고 있어요
상품 배송조건을 확인하고 있어요
준비된 배송 안내를 확인하고 있어요
방송에서 관련 장면을 찾고 있어요

Prototype에서는 약 1~2초 수준으로 연출 가능합니다.

---

# 13. Styling Agent

이번 Customer Demo의 Hero Feature입니다.

현재 LIVE 상품:

상의

추천 범위:

바지
스커트
신발

아우터 제외
가방 제외
주얼리 제외

신발은

Design
Color
Style

만 추천합니다.

신발 사이즈는 추천하지 않습니다.

---

# 14. Styling Candidate Pool

준비할 실제 GS SHOP 상품:

Bottom:
바지 + 스커트 약 8~12개

Shoes:
약 6~8개

Candidate Product Data:

product_id
product_name
category
color
silhouette
style_tags
image
price
product_url

---

# 15. Styling Preference Rule

강한 Signal:

primary_style = OFFICE

약한 Signal:

preferred_colors = GRAY / BLACK

추천 기준:

Color Compatibility
Silhouette Balance
Style Mood
Wearing Occasion
Customer Primary Style
Look Diversity

Gray / Black 조합만 반복하지 않습니다.

Look마다 컬러 변화가 있어야 합니다.

---

# 16. Lookbook Critical Rule

IMPORTANT

Runtime에서 Lookbook 이미지를 생성하지 않습니다.

Do NOT:

고객 클릭
→ Image Generation API
→ Loading
→ 결과

Do:

사전에 Look 조합 확정
→ Lookbook Image 생성
→ Static Asset 저장

Runtime:

Styling Agent
→ Look ID 선택
→ Static Lookbook 즉시 표시

Lookbook에는 반드시

`AI 코디 예시`

Label을 표시합니다.

실제 판매 상품 이미지는
Lookbook과 별도로 표시합니다.

---

# 17. Current Styling Look Direction

LOOK 01

Style:
OFFICE

현재 상의:
Gray Cashmere Pullover

Bottom:
Ivory Slacks

Shoes:
Black Loafers

Primary Recommendation for 김지수

---

LOOK 02

Style:
DATE

현재 상의:
Gray Cashmere Pullover

Bottom:
Brown / Cream Skirt

Shoes:
Ivory Mary Jane

---

LOOK 03

Style:
CASUAL_COMFORT

현재 상의:
Gray Cashmere Pullover

Bottom:
Blue Wide Denim

Shoes:
Ivory Sneakers

---

Look Mood Name과 실제 상품 조합, 정적 Lookbook 3개를 확정했습니다.
최종 상품 ID·이름·파일 경로는 §37과 fixtures/styling-looks.json을 따릅니다.

---

# 18. Customer Event

Prototype에서 주요 Event:

LIVE_ENTER

PRODUCT_DETAIL_OPEN

SIZE_TAB_OPEN

REVIEW_SIZE_VIEW

BENEFIT_DETAIL_OPEN

ASK_LIVE_SUBMIT

QUICK_ACTION_CLICK

STYLING_OPEN

STYLING_LOOK_CHANGE

STYLING_PRODUCT_CLICK

AI_SUGGESTION_SHOWN

AI_SUGGESTION_ACCEPT

AI_SUGGESTION_DISMISS

SIZE_RESULT_VIEW

BENEFIT_RESULT_VIEW

PURCHASE_CLICK

LIVE_RETURN

---

# 19. Need Detection Demo Rule

실서비스 Rule이 아닙니다.

Prototype Demo 전용입니다.

Rule:

30초 안에
동일 Need 관련 Event 2개 발생

→ Need Detected

같은 고객·방송·상품에서 서로 다른 신호 2종이 필요합니다.
같은 행동 반복과 같은 event_id 재전송은 감지 인원을 늘리지 않습니다.
상세 시간 경계·집계·승인 규칙은 §37을 따릅니다.

Example:

SIZE_TAB_OPEN

+

REVIEW_SIZE_VIEW

↓

SIZE NEED DETECTED

---

# 20. Proactive AI

Need가 감지되었다고
바로 Result Screen으로 이동하지 않습니다.

먼저 Small Suggestion을 보여줍니다.

Example:

"사이즈가 고민되시나요?"

"지수님에게 맞는 사이즈 정보를 확인해볼까요?"

Buttons:

확인하기
괜찮아요

확인하기:

→ Size Result

괜찮아요:

→ 동일 LIVE에서 같은 Need 선제 제안 재노출 금지

단,

사용자가 직접 `내 사이즈`를 누르는 것은 항상 허용합니다.

---

# 21. Director Purpose

현재 사용 중인 실시간 운영 Chat Console을 복제하지 않습니다.

기존 운영툴:

실시간 채팅 및 운영

GS AI LIVE Director:

AI Decision Support

Core Flow:

Monitor
→ Detect
→ Explain
→ Recommend
→ Approve
→ Measure

---

# 22. Director Demo Scenario

Primary Scenario:

SIZE NEED SPIKE

State:

NORMAL
→ ALERT
→ ACTION
→ RESULT

---

# 23. Director NORMAL

최소 Background KPI만 표시합니다.

Example:

Live Duration
Current Viewer
Order
Conversion
Revenue

Main:

현재 특이사항이 없습니다.

고객 반응을 실시간으로 분석하고 있어요.

Customer Need Trend도 보조적으로 표시합니다.

---

# 24. Director ALERT

Demo Example:

Previous:
신규 SIZE Need 감지 고객 8명

Current:
신규 SIZE Need 감지 고객 26명

Change:
+225%

Message:

"사이즈 관련 고객 관심이 빠르게 증가하고 있어요."

Evidence:

Size Tab View
Size Review View
Size ASK LIVE Question

Representative Questions:

"평소 66인데 그대로 주문하면 되나요?"

"모델은 몇 사이즈 입었어요?"

"반사이즈면 크게 사야 하나요?"

AI Explanation:

"최근 60초 동안 사이즈 관련 행동이 함께 나타난 고객이
8명에서 26명으로 증가했습니다.
평소 사이즈와 반사이즈 선택 기준을 안내하는 대응을 제안합니다."

---

# 25. Director ACTION

AI가 대응안을 추천합니다.

PD가 최종 승인합니다.

## Show Host

추천:

"사이즈 문의가 많습니다.
평소 사이즈 기준과 반사이즈 선택 방법을
한 번 더 안내해주세요."

Button:

쇼호스트에게 전달

Click:

✓ 쇼호스트에게 전달했습니다

실제 외부 메시지 시스템 연동은 하지 않습니다.

---

## APP Personalization

Size Need 관련 행동 고객에게만

`내 사이즈`

기능을 우선 노출합니다.

전체 고객에게 노출하지 않습니다.

승인 시 최근 120초 내 감지 고객을 고정하고 거절 고객은 제외합니다.
기존 내 사이즈 버튼에 테두리와 추천 표시만 추가하며 팝업은 열지 않습니다.
최대 5분 유지하고 상품 전환·방송 종료·거절 시 먼저 해제합니다.
쇼호스트 전달과 APP 승인은 독립입니다. 자세한 규칙은 §37을 따릅니다.

---

## Bookmark

Video Validation 성공 시만 추가합니다.

---

# 26. Director RESULT

Prototype Simulation 사용 가능.

Example:

사이즈 반복 질문

26 → 11
-58%

내 사이즈 이용

14 → 43
+207%

구매하기 클릭

82 → 95
+16%

반드시 화면에 표시:

`Prototype Simulation`

---

# 27. Video AI

2026-09-21 사용자 결정: 상품 이미지 기반 데모로 진행하고 실제 영상은 추후 연결합니다.
16:9 영역에 실제 상품 이미지와 `상품 이미지 기반 데모` 라벨을 표시합니다.
아래 영상 AI는 현재 비활성화하고 실제 영상 확보 후 검증합니다.

다음 Capability는 실제 영상으로 테스트 후 결정합니다.

Summary
Bookmark
Video Search
아까 뭐라고 했어?
Catch-up
Video ASK LIVE
Model Worn Size Extraction

각 기능별로:

PASS
PARTIAL
FAIL

판정합니다.

PASS만 Main Demo에 사용합니다.

Video AI 때문에 P0 구현을 지연하지 않습니다.

---

# 28. Logical Agent List

P0:

ASK LIVE Agent
Size Agent
Benefit Agent
Styling Agent
Need Detection Agent
Director Insight Agent
Director Action Agent
Result Measurement Capability

Video Validation:

Summary / Bookmark Agent
Video Search Agent
Catch-up Agent

Review Insight는 별도 Agent로 만들지 않습니다.

ASK LIVE 내부 Capability입니다.

Agent는 Logical Role입니다.

각각 별도 Service나 별도 LLM으로 구현할 필요는 없습니다.

---

# 29. Implementation Order

PHASE 1

UI Skeleton

Portrait LIVE
Landscape LIVE
Conversation
Product Summary
Quick Actions
Product Detail Routing
Director Layout

---

PHASE 2

Stable Customer AI

내 혜택
내 사이즈
Review ASK LIVE
Thickness ASK LIVE
Color ASK LIVE
Delivery ASK LIVE

---

PHASE 3

Styling Hero

Candidate Fixture
Styling Logic
Look Mapping
Static Lookbook
Actual Product Card
GS SHOP Link

---

PHASE 4

Customer Event / Need Detection

Event Tracking
Size Rule
Proactive Suggestion
Related Customer Segment

---

PHASE 5

Director Loop

NORMAL
ALERT
ACTION
RESULT

APP Personalization과 Customer UI 연결

---

PHASE 6

Video AI

실제 영상 검증

검증된 기능만 Main Demo 연결

---

# 30. Developer Demo Control

Customer에게 노출하지 않는
Developer-only Demo Control을 허용합니다.

Recommended:

Trigger Size Need

Trigger Director Spike

Move Director to Result

Trigger Catch-up — 현재 비활성화

Reset Demo / Start Need Demo 추가

Fixture를 68초까지 재생한 뒤, Trigger Director Spike가 미처리 이벤트를 120초까지 이어 재생합니다.
Result 이동은 APP 승인 후 가상 30초 이상 지난 경우에만 허용합니다.

Purpose:

발표 중 Trigger 실패 방지

실제 서비스 기능이 아닙니다.

---

# 31. Fallback

ASK LIVE 실패

→ Prepared Response 사용

Size Agent 실패

→ Prepared Size Result 사용

Benefit Agent 실패

→ Prepared Benefit Result 사용

Styling 실패

→ Default LOOK 01 사용

Lookbook 실패

→ 실제 Product Card만 표시

Director Trigger 실패

→ Demo Control 사용

Video AI 실패

→ 해당 Capability Demo 제외

발표 중 빈 화면을 보여주지 않는 것을 우선합니다.

---

# 32. Explicitly Out of Scope

실제 Streaming Infrastructure

GS SHOP 전체 Catalogue 실시간 Crawling

Runtime Lookbook Generation

Personal Wardrobe

Advanced Body Styling

Shoe Size Recommendation

Accessories Styling

Real Delivery Integration

Real Customer Personal Data

Real Show Host Messaging Integration

Actual Caption Broadcast

Autonomous Broadcast Control

Full VOD Product

General-purpose Commerce Agent

Actual CVR Lift Validation

---

# 33. Definition of Prototype Success

이번 Prototype은

AI가 모든 것을 할 수 있다는 것을 보여주는 프로젝트가 아닙니다.

다음을 안정적으로 보여주면 성공입니다.

Customer가 LIVE 안에서 AI를 사용한다.

AI가 실제 상품 데이터를 이용해 구매 판단을 돕는다.

Styling Agent가 실제 GS SHOP 상품을 새롭게 발견하게 한다.

Customer 행동이 Need Signal로 변환된다.

동일 Need가 증가하면 Director가 이를 감지한다.

AI가 PD에게 적절한 Action을 추천한다.

PD가 Action을 승인한다.

해당 Action이 관련 Customer Experience에 반영된다.

Action 이후 변화를 다시 확인한다.

이 Loop가 발표 중 안정적으로 동작하는 것이
이번 Prototype의 최우선 목표입니다.

---

# 34. 샘플 데이터 출처 및 확인 결과

보완일: 2026-09-21

이 절은 Vision Document, 본 Handoff, 사용자가 지정한 상품 페이지를 대조하여
해소된 데이터·동작 규칙·검수 기준을 기록합니다.

`해소`는 구현에 사용할 출처나 기대 동작이 정해졌다는 뜻입니다.
기능 구현 완료, 검수 통과, 이미지·영상·Fixture 파일 준비 완료를 의미하지 않습니다.

## 34.1 메인 상품 원본

- 상품 ID: `1084192893`
- 원본: [GS SHOP 상품 페이지](https://m.gsshop.com/prd/prd.gs?prdid=1084192893)
- 확인일: 2026-09-21
- 확인 범위: 공개 상품 페이지의 기본정보, 옵션, 이미지 URL, 배송 안내, 상품 FAQ

| 항목 | 페이지에서 확인한 값 | 기존 Handoff와의 관계 |
| --- | --- | --- |
| 상품명 | SJ와니 샤이니 크리즈 캐시미어 풀오버 1종 (런칭 가격 149,900원) | §7의 메인 상품과 동일 |
| 판매가 | 49,900원 | §7·§9의 기준 가격과 일치; 상품명에 포함된 런칭 가격과 구분 |
| 색상 | 그레이 / 블랙 / 크림 | 현재 상의의 색상 데이터로 활용 가능 |
| 사이즈 | 55 / 66 / 77 / 88 옵션 확인 | 색상별 옵션 구성·재고가 모두 동일하다는 뜻은 아님 |
| 평점 | 4.5 | §7과 일치 |
| 리뷰 수 | 1,200건 | 이전 문서 1,199건에서 최종 검증값 1,200건으로 고정 |
| 배송비 | 무료배송 | §7과 일치; 특정 고객의 도착일을 의미하지 않음 |
| 상품 이미지 | 대표·추가 8장과 상세 5장 | 로컬 확보·출처·파일 해시 검증 완료 |
| 사이즈 FAQ | 평소 착용 사이즈 권장, 반사이즈는 큰 쪽 권장, 상세 치수와 선호 핏 참고 | §10의 상품 안내 근거로 사용 가능 |

대표 이미지 원본:
[상품 대표 이미지](https://asset.m-gs.kr/prod/1084192893/1/550)

추가 이미지 URL은 같은 형식의 이미지 번호 `2`부터 `8`까지 확인했습니다.
그레이·블랙·크림 이미지와 옵션을 대조했습니다. 상세의 라벤더는 현재 구매 옵션에 없으므로 구매 가능으로 단정하지 않습니다.

## 34.2 실제 확인값과 데모 준비값 구분

가상 고객과 준비된 사이즈·혜택 결과는 유지합니다. 리뷰 수는 1,200건으로 고정했고
선택형 리뷰도 공개 API로 재검증했습니다. 확인일이 있는 스냅샷으로 관리합니다.

| 데이터 | 현재 상태 | 사용 기준 |
| --- | --- | --- |
| 상품 기본정보·이미지 URL·사이즈 FAQ | 공개 페이지에서 확인 | 원본 URL과 확인일을 함께 기록 |
| 리뷰 수 1,200건 | 공개 페이지·리뷰 API 검증값 | 최종 Fixture와 UI 기대값으로 채택; 1,199건은 과거 기록 |
| §8의 선택형 리뷰 비율 | 공개 리뷰 API로 5항목 모두 검증 | 구매자 리뷰 기준으로 표시; 합계 99%와 응답 수 차이를 보존 |
| 김지수의 VIP·GS Pay·평소 66·스타일 선호 | 가상 고객 프로필 | 실제 고객 조회 결과로 표현하지 않음 |
| 최종 혜택가 45,515원 | §9의 데모 기대 결과 | 공개 페이지에서 확인한 개인별 실결제 금액으로 표현하지 않음 |
| 고객별 배송예정일 | 주문 후 2~3영업일이라는 Mock 응답 고정 | 배송 시뮬레이션 라벨과 실제 주문 단계 확인 안내 |

리뷰의 `잘 맞아요 87%`는 공개 API로 재확인한 사이즈 평가 비율입니다.
별도 근거 없이 `66 구매자의 87%` 또는 `김지수에게 맞을 확률 87%`로 해석하지 않습니다.
전체 리뷰 수가 각 선택형 문항의 응답자 수와 같다고 가정하지 않습니다.

## 34.3 개발 시 참고할 데이터와 적용 순서

**사용자 지정 기준 상품**: [GS SHOP — SJ와니 샤이니 크리즈 캐시미어 풀오버](https://m.gsshop.com/prd/prd.gs?prdid=1084192893), 상품 ID `1084192893`.
사용자 제공 링크의 마지막 쉼표는 제외하며, 유입 경로인 `bnclick/rank/iid/mseq`는 상품 식별·가격·재고의 기준으로 사용하지 않는다. 위 정규화 URL을 공통 원본 링크로 사용한다.

| 참고 자료 | 가져올 데이터·역할 | 실제 구현 참조(프로젝트 루트 기준) |
| --- | --- | --- |
| 상품 페이지 | 상품명·브랜드·판매가·옵션·이미지·평점·배송비 | `fixtures/main-product.json`: `product_id`, `display_name`, `brand`, `price`, `colors`, `sizes`, `options`, `images`, `rating`, `shipping` |
| [공개 구매정보](https://m.gsshop.com/prd/prdBuyingInfo.gs?prdid=1084192893&format=json) | 소재·세탁·의류 실측표·제조사 안내 | 같은 파일: `material`, `size_guide`, `manufacturer_guidance` |
| [공개 리뷰 집계](https://m.gsshop.com/product/api/revw/v0/reviewMain/1084192893?mseq=397078&prsnInclYn=Y&prsnFilterYn=N) | 리뷰 수·평점·선택형 평가 비율·문항별 응답 수 | 같은 파일: `rating`, `review_summary`, `source_disagreements` |
| 고객·준비 결과 | 가상 프로필·66 사이즈 안내·개인 혜택 예시·배송 Mock | `fixtures/demo-config.json`: `demo_customer`, `size_result`, `benefit_result`, `delivery_result` |
| 질문 답변 | 지원 Intent·답변·Direct Result 이동·근거 필드 | `fixtures/ask-live.json`: `responses`, `direct_result_routes`, `source_priority`, `unsupported` |
| 코디 상품·Look | 실제 하의/신발 후보와 확정 3 Look·정적 이미지·실제 링크 | `fixtures/styling-candidates.json`, `fixtures/styling-looks.json` |
| Need·Director·성과 | 본 문서의 확정 규칙과 가상 이벤트·고정 KPI | `fixtures/director-scenario.json`, `docs/need-director-rules.md` |
| 출처·확인 이력 | 원본 URL·확인 시각·자료 유형·해석 제한 | `docs/product-data-sources.md`, `main-product.json`의 `sources.*` |

적용 순서와 데이터 경계:

1. 상품 페이지·구매정보·리뷰는 **상품 사실의 원본**, 본 Handoff는 **기능·동작·검수 기대값**, 로컬 Fixture는 **데모 실행에 채택한 스냅샷**으로 구분한다. 공개 페이지를 발표 중 실시간 수집하여 화면별 값이 달라지게 하지 않는다.
2. 가격·재고·리뷰 등 변동 데이터에는 원본과 확인 시각을 유지한다. 2026-09-21 이번 상품 페이지 조회에는 리뷰 1,199건이 표시되지만, 기존 데모 기준은 1,200건·문항별 응답 합계 1,202건이다. 이 차이는 재조회 기록으로 보존하며 이번 출처 명시 작업에서 고정값을 덮어쓰지 않는다. 차이의 원인은 확정하지 않았다.
3. 새 데이터로 갱신할 때는 원본·확인 시각·차이를 검토하고 공통 Fixture·관련 문서·검수 기대값을 함께 바꾼다. 기존 구매정보·리뷰 API 수집 기록과 이번 상품 페이지 참조 확인을 구분한다.
4. 가상 고객의 VIP·GS Pay·평소 66, 혜택 45,515원, 도착 예상 2~3영업일, Director KPI는 상품 페이지에서 확인한 실고객·실결제·실배송·실성과가 아니다. 기존 Prepared/Mock/Simulation 라벨을 유지한다.
5. HTML은 화면·상호작용 참고 자료이고, 별도 코어어센틱 가디건 MP4는 다른 상품의 녹화 참고 영상이다. 해당 예시값·발화·착용정보를 SJ와니 상품의 사실 근거로 섞지 않는다. 추천 하의·신발도 메인 상품에 포함된 구성으로 표시하지 않는다.


---

# 35. 해소된 항목과 구현·검수 기준

다음은 앱 UI 검수 기준입니다. 실제 앱 UI의 실행 결과는 아니며,
별도로 실행한 로직·자료 검증 결과는 §37에 기록합니다.

| 영역 | 해소된 내용 | 구현 후 확인할 기준 | 근거 |
| --- | --- | --- | --- |
| 메인 상품 | 데모 상품과 공개 원본 출처가 정해짐 | 상품 ID, 선택한 기준 가격·리뷰 수, 상품 이미지가 최종 Fixture와 일치 | §7, §34 |
| Demo Customer | 가상 고객의 사이즈·회원·결제·스타일 설정이 정해짐 | 김지수 프로필 사용; 주소를 노출할 경우 `서울 영등포구` 수준으로 표시 | §6 |
| 내 사이즈 | 단일 고객의 결과와 설명, 이동 경로가 정해짐 | `66 사이즈를 먼저 확인해보세요`, 문서의 87% 근거, 사이즈 탭 이동 및 66 선택 동작 확인 | §10 |
| 내 혜택 | 단일 고객의 할인 항목과 최종 금액이 정해짐 | 할인 합계 4,385원, 최종 45,515원 표시 | §9 |
| 화면 전환 | 버튼 전환과 Conversation State 공유가 정해짐 | 세로·가로 전환 후 기존 메시지와 대화 맥락 유지; 동일한 AI 기능 접근 가능 | §3 |
| 대화·결과 UI | 발화 주체와 기능별 표시 경로가 정해짐 | CUSTOMER / OPERATOR / ASK LIVE / SYSTEM 구분; 사이즈·혜택·코디는 Direct Result | §4~§5 |
| ASK LIVE | P0 Intent와 답변 근거의 종류가 정해짐 | 후기·두께·색상은 준비한 상품·리뷰 자료와 일치; 배송은 준비한 Mock에 근거 | §8, §11 |
| 선제 제안 | 결과로 바로 이동하지 않는 방식과 수락·거절 동작이 정해짐 | 수락 시 Size Result; 거절 후 동일 LIVE·Need 선제 제안 재노출 금지; 수동 `내 사이즈`는 허용 | §20 |
| Styling 표시 | 사전 이미지와 실제 상품을 구분하는 방식이 정해짐 | Look ID에 대응하는 정적 이미지 사용; `AI 코디 예시` 표시; 실제 상품 카드·링크 별도 표시 | §14~§17 |
| 쇼호스트 Action | 실제 외부 전송 없이 완료 상태까지 구현하는 범위가 정해짐 | 버튼 선택 후 `쇼호스트에게 전달했습니다` 상태 표시 | §25 |
| Simulation 결과 | 결과 화면의 표시 문구가 정해짐 | 시뮬레이션 결과에 `Prototype Simulation` 표시 | §26 |
| 실패 대응 | 기능별 Fallback이 정해짐 | 준비된 답변·결과, Default LOOK 01, 상품 카드, Demo Control 등 §31의 대체 동작 확인 | §31 |

내 혜택의 데모 계산은 다음과 같이 일치합니다.

`49,900 - 2,495 - 1,890 = 45,515원`

GS Pay 할인 1,890원의 할인율·반올림 규칙은 아직 정의되지 않았습니다.
현재 단일 고객 데모는 §9의 준비값을 사용할 수 있으며,
이 값만으로 다른 고객에게 적용할 일반 계산식을 추정하지 않습니다.

§24·§26의 예시 증감률도 산술적으로 일치합니다.

- Size Signal 8 → 26: +225%
- 사이즈 반복 질문 26 → 11: 약 -58%
- 내 사이즈 이용 14 → 43: 약 +207%
- 구매하기 클릭 82 → 95: 약 +16%

원문의 Example을 최종 시나리오의 고정 Simulation 값으로 채택했습니다.
실제 사업 성과나 실행 중 측정한 인과 효과로 취급하지 않습니다.
§12의 약 1~2초도 연출 가능한 예시이며 확정된 응답 시간 합격 기준은 아닙니다.

---

# 36. 미결정 항목 해결 현황

사용자 자율 해결 요청에 따라 규칙과 자료를 확정했습니다.

| 기존 항목 | 확정·준비 결과 | 상태 | 산출물 |
| --- | --- | --- | --- |
| 개인 Need | 같은 고객·방송·상품, 30초 내 서로 다른 SIZE 신호 2종. event_id 중복 제외. 최초 감지 1회 | 규칙·reference 검증 완료 | [규칙](/Users/yeongjae/Desktop/aidlc-v1-sample-project/docs/need-director-rules.md), [코드](/Users/yeongjae/Desktop/aidlc-v1-sample-project/prototype/need_director.py) |
| 집단 Spike | 직전/현재 각60초 신규 감지 고유 고객 비교. 현재10명 이상·이전2배 이상. 8→26(+225%)를 Fixture로 재현 | 규칙·reference 검증 완료 | [시나리오](/Users/yeongjae/Desktop/aidlc-v1-sample-project/fixtures/director-scenario.json) |
| PD 개인화 | 승인 시 최근120초 고객 snapshot, 거절 고객 제외. 내 사이즈 버튼만 강조. 5분TTL, 상품전환·거절 시 해제 | 규칙·reference 검증 완료 | [규칙](/Users/yeongjae/Desktop/aidlc-v1-sample-project/docs/need-director-rules.md) |
| 대화 처리 | 운영자 공용, 고객 질문·AI 답변 개인. SIZE는Direct Result. 미지원·영상·지연 응답 정책 고정 | 명세·답변 데이터 준비 완료 | [대화정책](/Users/yeongjae/Desktop/aidlc-v1-sample-project/docs/conversation-policy.md), [답변](/Users/yeongjae/Desktop/aidlc-v1-sample-project/fixtures/ask-live.json) |
| 최종 샘플 데이터 | 1,200건 채택, 선택형리뷰5항목 실제API 확인, 사이즈표8실측항목, 메인이미지13장, 혜택준비값·배송Mock 구분 | 준비·데이터 검증 완료 | [상품](/Users/yeongjae/Desktop/aidlc-v1-sample-project/fixtures/main-product.json), [데모설정](/Users/yeongjae/Desktop/aidlc-v1-sample-project/fixtures/demo-config.json), [출처](/Users/yeongjae/Desktop/aidlc-v1-sample-project/docs/product-data-sources.md) |
| 코디 콘텐츠 | 실제 하의8·신발6, 최종3Look, 실제상품카드 이미지, 사전생성Lookbook3장 | 준비·파일연결 검증 완료 | [후보](/Users/yeongjae/Desktop/aidlc-v1-sample-project/fixtures/styling-candidates.json), [Look](/Users/yeongjae/Desktop/aidlc-v1-sample-project/fixtures/styling-looks.json), [출처](/Users/yeongjae/Desktop/aidlc-v1-sample-project/docs/styling-sources.md) |
| 영상 | 사용자가 상품 이미지 기반 데모, 실제영상 추후연결 선택. 영상AI 비활성화 | 현재범위 결정 완료 / 실제영상·AI 검증 보류 | [데모설정](/Users/yeongjae/Desktop/aidlc-v1-sample-project/fixtures/demo-config.json) |
| 통합 검수 | A포함·B/C제외,33명승인,8→26,거절·중복·경계·만료. UI검수표20항목과시연순서 작성 | 로직·자료 검증 완료 / 앱 UI 검수 대기 | [검수표](/Users/yeongjae/Desktop/aidlc-v1-sample-project/docs/acceptance-checklist.md), [검증결과](/Users/yeongjae/Desktop/aidlc-v1-sample-project/docs/verification-report.json) |

---

# 37. 확정 산출물과 구현 기본값

결정일: 2026-09-21. 사용자가 미결정 문제의 자율 해결을 요청했고,
영상은 상품 이미지 기반 데모로 진행한 뒤 추후 연결하도록 결정했다.
이 결정본은 기존 Handoff의 미결정·예시·미재검증 상태를 아래 범위에서 갱신한다.

## 데이터와 미디어

- 리뷰 수는 실제 확인한 1,200건으로 고정한다.
- 선택형 리뷰 5항목은 공개 리뷰 API에서 재확인했다. 원문의 87%·63%·91% 등과 모두 일치한다.
- 리뷰 총수 1,200과 선택형 응답 합계 1,202는 원본대로 보존한다. 비율을 재계산하거나 99%를 보정하지 않는다.
- 두께 답변에는 제조사 가이드와 구분하여 `구매자 리뷰 기준`을 표시한다.
- 상품 이미지 8장과 상세 이미지 5장, cm 단위 실측표 8항목을 로컬 자산과 JSON으로 준비했다.
- 그레이 66은 확인 시점 실제 페이지에서 `일시품절`이다. 66 추천과 구매 가능 여부를 구분한다.
- 혜택 45,515원은 가상 고객의 준비값이며 `데모 혜택 예시`를 표시한다.
- 배송 답변은 `배송 시뮬레이션 기준으로 주문 후 2~3영업일 내 도착 예정이에요. 상품 페이지에는 무료배송으로 안내되어 있어요. 실제 도착일은 주문 단계에서 확인해주세요.`로 고정한다.
- 구매는 선택 옵션과 금액을 확인하는 시뮬레이션이며 실제 주문을 생성하지 않는다. 원본 이동은 `실제 상품 보기`로 구분한다.
- 16:9 영역에 실제 상품 이미지를 표시하고 `상품 이미지 기반 데모` 라벨을 붙인다. 영상 AI는 비활성화한다.

## 개인 Need와 Director

- 같은 고객·방송·상품에서 30초 내 사이즈표·사이즈 리뷰·사이즈 질문 중 서로 다른 2종이 발생해야 감지한다. 정확히 30초까지 포함한다.
- 같은 event_id는 한 번만 처리한다. 같은 행동 반복은 신호 종류를 늘리지 않는다. 고객·방송·상품별 최초 감지만 인원에 포함한다.
- `Size Signal` 단위는 신규 SIZE Need가 감지된 고유 고객 수다. 직전과 현재 각 60초를 비교한다.
- 현재 10명 이상이면서 직전의 2배 이상이면 ALERT다. 직전 0명은 현재 10명 이상일 때 감지하고 증가율 대신 `신규 증가`로 표시한다.
- PD 설명은 관찰된 행동 증가만 설명하며 실제 구매 장애나 인과 효과를 단정하지 않는다.
- APP 승인 시 최근 120초 내 같은 방송·상품의 감지 고객을 snapshot으로 고정한다. 같은 LIVE에서 제안을 거절한 고객은 제외한다.
- 대상 고객의 기존 `내 사이즈` 버튼에 테두리와 `추천` 표시만 추가한다. 새 팝업이나 Result를 자동으로 열지 않는다.
- 강조는 승인 후 5분 미만이며, 상품 전환·방송 종료·거절 시 먼저 해제된다. 재승인으로 대상이나 기간을 늘리지 않는다.
- 거절은 승인보다 우선한다. 수동 내 사이즈는 항상 허용한다. 쇼호스트 전달은 APP 승인과 독립이다.

## 대화·실패 처리

- 운영자는 방송 공용, 고객 질문과 ASK LIVE 답변은 개인에게만 표시한다. 입력창은 `AI에게 질문`으로 표시한다.
- 사이즈·혜택·코디 질문은 Direct Result로 연결한다. 사이즈 질문은 `SIZE_GUIDANCE`로 기록한다.
- 영상 장면·모델 착용 사이즈는 영상 미연결 안내를 우선한다. 고객 사이즈 66으로 대체 답변하지 않는다.
- 지원 밖 질문과 근거 부족 질문에는 확인 불가 안내와 상품문의 경로를 제공한다.
- 준비 답변은 바로 표시할 수 있다. 외부 응답은 최대 5초 후 같은 Intent의 준비 답변으로 대체한다. 늦은 응답을 중복 표시하지 않는다.
- 세로·가로 전환 후 대화·진행 중 요청·상품·고객·선택 사이즈·Look·열린 결과·이미지 위치를 유지한다.

## 확정 코디와 자산

| Look | Mood | 실제 하의 | 실제 신발 |
| --- | --- | --- | --- |
| LOOK 01 | 차분한 출근길 | 코어 어센틱 아이보리 롤업 슬랙스 `1103554292` | 핏플랍 검정 로퍼 `1092943486` |
| LOOK 02 | 부드러운 약속 | 코어 어센틱 브라운 새틴 롱스커트 `1103680106` | 헬시온 아이보리 더블스트랩 메리제인 `1110407317` |
| LOOK 03 | 여유로운 주말 | 피핀 청색 와이드 데님 `1052764372` | 고세 아이보리 메쉬 스니커즈 `1085417942` |

실제 하의 8개·신발 6개의 후보 자료를 확보했다. 선택된 세 Look 모두 정적 Lookbook을 생성했다.
OFFICE를 기본 추천하고 DATE·CASUAL_COMFORT를 함께 제공한다. 신발 사이즈는 추천하지 않는다.
AI 이미지는 코디 분위기 예시이며, 실제 상품 이미지·링크를 별도로 표시한다.

## 시연과 검수

방송 ID는 `GS-LIVE-DEMO-001`, 상품 ID는 `1084192893`, 검토 고객은 `customer-A/B/C`다.

1. Start Need Demo는 자유 체험의 이벤트 상태와 가상 시계를 초기화하고 68초까지 재생한다. A의 제안과 C의 거절을 확인한다.
2. Trigger Director Spike는 미처리 이벤트만 120초까지 이어 재생한다. 직전 8명·현재 26명(+225%)을 같은 집계 경로로 계산한다.
3. 121초 APP 승인 시 최근 120초의 34명 중 C를 제외한 33명이 대상이다. A는 포함되고 B/C는 제외된다.
4. 151초에 준비된 결과를 표시한다. 이는 전후 60초 Simulation 스냅샷을 꺼내는 재생 일정이며 실측 종료 시각이 아니다.
5. 421초에 버튼 강조가 만료된다. 다시 시연할 때 이벤트·거절·승인·결과·시계를 초기화한다.

ALERT의 26명과 RESULT의 반복 질문 26건은 다른 지표다. 결과 지표는 원문의 예시를
최종 Simulation 값으로 채택했으며 실제 성과로 해석하지 않는다.

검증된 범위:

- Need·Spike·중복·거절·승인·만료 로직 테스트 15개 통과.
- 상품/답변/Look 연결, 가격 계산, 이미지 파일과 해시, 리뷰 비율, 실측표, 중간 정지 후 재생 검증 통과.
- 자료 검토 페이지는 모바일·데스크톱 브라우저에서 13개 동작 검사 통과.
- 실제 고객/PD 앱 UI의 통합 검수는 앱 구현 후 `docs/acceptance-checklist.md`로 실행한다.
- 실제 영상과 영상 AI는 사용자 결정에 따라 추후 연결한다. 현재 준비 범위에서 추가 사용자 결정은 필요하지 않다.

## 산출물 위치

프로젝트 루트: `/Users/yeongjae/Desktop/aidlc-v1-sample-project`

| 자료 | 루트 기준 경로 |
| --- | --- |
| 상품·리뷰·실측표 | `fixtures/main-product.json` |
| 고객·혜택·배송·미디어 설정 | `fixtures/demo-config.json` |
| ASK LIVE 답변·출처·라우팅 | `fixtures/ask-live.json` |
| 코디 후보·Look 매핑 | `fixtures/styling-candidates.json`, `fixtures/styling-looks.json` |
| 가상 이벤트·결과 | `fixtures/director-scenario.json` |
| 실제 상품 이미지 | `assets/products/main/`, `assets/products/styling/` |
| 생성 Lookbook | `assets/lookbooks/look-01.png`~`look-03.png` |
| 내장 image_gen 생성 프롬프트·입력·저장 기록 | `assets/lookbooks/generation.json` |
| 오프라인 자료 미리보기 | `preview/index.html` |
| 상세 규칙·대화 정책·검수표 | `docs/need-director-rules.md`, `docs/conversation-policy.md`, `docs/acceptance-checklist.md` |
| 검증 결과 | `docs/verification-report.json` |

프로젝트 루트에서 실행:

```sh
python3 scripts/validate_demo.py --write-report
python3 -m unittest discover -s tests -p 'test_need_director.py' -v
python3 prototype/need_director.py
```

[자료·Lookbook 미리보기](/Users/yeongjae/Desktop/aidlc-v1-sample-project/preview/index.html)
